"""Supabase-issued JWT verification for DRF.

Supabase Auth owns sign-up, sign-in and password-reset email and hands the
browser a signed JWT. Django never sees a password: it re-verifies that token on
every request with PyJWT and maps the `sub` claim onto a local Django user.

Supabase signs access tokens one of two ways, and we support both:

* **Asymmetric (ES256/RS256)** — the current default. Tokens carry a `kid` and
  are verified against the project's *public* keys, fetched from
  ``{SUPABASE_URL}/auth/v1/.well-known/jwks.json`` and cached. Nothing secret is
  needed on our side.
* **HS256 shared secret** — the legacy model, verified with
  ``SUPABASE_JWT_SECRET`` (Settings > API > JWT Secret). Note this is the
  *signing secret*, NOT the service_role key (which is itself a JWT).

The algorithm in the token header selects the path, so a project that migrates
from one to the other keeps working without a code change.
"""

import logging

import jwt
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from drf_spectacular.extensions import OpenApiAuthenticationExtension
from rest_framework import authentication, exceptions

from apps.accounts.models import Profile

logger = logging.getLogger(__name__)

User = get_user_model()

# Supabase stamps every end-user access token with this audience.
SUPABASE_AUDIENCE = "authenticated"

SYMMETRIC_ALGORITHMS = ["HS256"]
ASYMMETRIC_ALGORITHMS = ["ES256", "RS256"]

# One PyJWKClient per JWKS url; it caches keys and refetches when it sees an
# unknown `kid` (i.e. after a Supabase key rotation).
_jwk_clients: dict[str, jwt.PyJWKClient] = {}


def get_jwks_client(url):
    client = _jwk_clients.get(url)
    if client is None:
        client = jwt.PyJWKClient(url, cache_keys=True, lifespan=600, timeout=10)
        _jwk_clients[url] = client
    return client


def jwks_url():
    """Derive the project's JWKS endpoint from SUPABASE_URL."""
    base = (settings.SUPABASE_URL or "").rstrip("/")
    if not base:
        return ""
    return f"{base}/auth/v1/.well-known/jwks.json"


class SupabaseJWTAuthentication(authentication.BaseAuthentication):
    """Authenticate `Authorization: Bearer <supabase access token>`.

    Returns ``(user, payload)``; the raw claims are available as
    ``request.auth`` for anything that needs them.
    """

    keyword = "Bearer"

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).split()

        if not header or header[0].lower() != self.keyword.lower().encode():
            # Not our scheme — let another authenticator (or AnonymousUser) handle it.
            return None
        if len(header) == 1:
            raise exceptions.AuthenticationFailed("Bearer token missing.")
        if len(header) > 2:
            raise exceptions.AuthenticationFailed(
                "Authorization header must not contain spaces."
            )

        try:
            token = header[1].decode("utf-8")
        except UnicodeError:
            raise exceptions.AuthenticationFailed("Malformed bearer token.")

        payload = self.decode_token(token)

        supabase_user_id = payload.get("sub")
        if not supabase_user_id:
            raise exceptions.AuthenticationFailed("Token has no subject (sub) claim.")

        user = self.get_or_create_user(
            supabase_user_id, payload.get("email") or "", payload
        )
        if not user.is_active:
            raise exceptions.AuthenticationFailed("User account is disabled.")

        return (user, payload)

    def authenticate_header(self, request):
        # Makes DRF answer 401 (not 403) when authentication is missing.
        return f'{self.keyword} realm="api"'

    def decode_token(self, token):
        try:
            algorithm = jwt.get_unverified_header(token).get("alg")
        except jwt.InvalidTokenError:
            raise exceptions.AuthenticationFailed("Malformed bearer token.")

        if algorithm in ASYMMETRIC_ALGORITHMS:
            key = self.get_public_key(token)
            algorithms = ASYMMETRIC_ALGORITHMS
        elif algorithm in SYMMETRIC_ALGORITHMS:
            key = settings.SUPABASE_JWT_SECRET
            algorithms = SYMMETRIC_ALGORITHMS
            if not key:
                # A misconfigured server must not silently accept unverified tokens.
                logger.error(
                    "SUPABASE_JWT_SECRET is not set; cannot verify HS256 tokens."
                )
                raise exceptions.AuthenticationFailed(
                    "Auth is not configured on the server."
                )
        else:
            raise exceptions.AuthenticationFailed(
                f"Unsupported token algorithm: {algorithm!r}."
            )

        try:
            return jwt.decode(
                token,
                key,
                algorithms=algorithms,
                audience=SUPABASE_AUDIENCE,
                options={"require": ["exp", "sub"]},
            )
        except jwt.ExpiredSignatureError:
            raise exceptions.AuthenticationFailed("Token has expired.")
        except jwt.InvalidAudienceError:
            raise exceptions.AuthenticationFailed(
                "Token audience is not 'authenticated'."
            )
        except jwt.InvalidTokenError:
            # Covers bad signature, wrong algorithm, missing claims, malformed token.
            raise exceptions.AuthenticationFailed("Invalid token.")

    def get_public_key(self, token):
        """Fetch the project's public signing key matching the token's `kid`."""
        url = jwks_url()
        if not url:
            logger.error("SUPABASE_URL is not set; cannot fetch JWKS to verify tokens.")
            raise exceptions.AuthenticationFailed("Auth is not configured on the server.")

        try:
            return get_jwks_client(url).get_signing_key_from_jwt(token).key
        except jwt.exceptions.PyJWKClientError as exc:
            # Unknown kid, or the key set could not be fetched/parsed.
            logger.warning("JWKS lookup failed for %s: %s", url, exc)
            raise exceptions.AuthenticationFailed("Could not verify token signature.")
        except jwt.InvalidTokenError:
            raise exceptions.AuthenticationFailed("Malformed bearer token.")

    def get_or_create_user(self, supabase_user_id, email, payload=None):
        """Map a Supabase uuid onto a local User + Profile, creating both once."""

        # Upgrade-only: a token that doesn't carry the claim (its exact shape
        # isn't guaranteed stable across Supabase/GoTrue versions — this checks
        # both places it's been seen) must never be read as "actually
        # unverified" and flip a previously-verified profile back to False.
        payload = payload or {}
        email_verified = bool(
            payload.get("email_verified") or payload.get("user_metadata", {}).get("email_verified")
        )

        profile = (
            Profile.objects.select_related("user")
            .filter(supabase_user_id=supabase_user_id)
            .first()
        )
        if profile is not None:
            if email and profile.user.email != email:
                # Supabase is the source of truth for the address.
                profile.user.email = email
                profile.user.save(update_fields=["email"])
            if email_verified and not profile.email_verified:
                profile.email_verified = True
                profile.save(update_fields=["email_verified"])
            return profile.user

        try:
            with transaction.atomic():
                user = User.objects.create_user(
                    username=str(supabase_user_id),
                    email=email,
                )
                # Unusable password: authentication only ever happens via Supabase.
                user.set_unusable_password()
                user.save(update_fields=["password"])
                Profile.objects.create(
                    user=user,
                    supabase_user_id=supabase_user_id,
                    display_name=email.split("@")[0][:60] if email else "",
                    email_verified=email_verified,
                )
        except IntegrityError:
            # Two concurrent first requests from the same new user; one lost the race.
            profile = (
                Profile.objects.select_related("user")
                .filter(supabase_user_id=supabase_user_id)
                .first()
            )
            if profile is None:
                raise
            return profile.user

        return user


class SupabaseJWTAuthenticationScheme(OpenApiAuthenticationExtension):
    """Teaches drf-spectacular how to document the authentication above.

    Without this, schema generation warns that it cannot resolve the
    authenticator and the docs render no "Authorize" control at all.
    """

    target_class = "apps.accounts.authentication.SupabaseJWTAuthentication"
    name = "SupabaseJWT"

    def get_security_definition(self, auto_schema):
        return {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
            "description": (
                "Supabase access token. Sign in through the frontend, then send "
                "it as `Authorization: Bearer <token>`."
            ),
        }
