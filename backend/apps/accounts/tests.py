import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.authentication import SUPABASE_AUDIENCE
from apps.accounts.models import Profile

User = get_user_model()
SECRET = "test-jwt-secret"


def make_token(sub=None, email="trav@example.com", secret=SECRET, **overrides):
    now = datetime.now(tz=timezone.utc)
    payload = {
        "sub": sub or str(uuid.uuid4()),
        "email": email,
        "aud": SUPABASE_AUDIENCE,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=1)).timestamp()),
    }
    payload.update(overrides)
    return jwt.encode(payload, secret, algorithm="HS256")


@pytest.fixture
def settings_secret(settings):
    settings.SUPABASE_JWT_SECRET = SECRET
    return settings


@pytest.fixture
def client():
    return APIClient()


def auth(client, token):
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return client


# --- Authentication -------------------------------------------------------


@pytest.mark.django_db
def test_no_token_is_401(client):
    resp = client.get("/api/profile/me/")
    assert resp.status_code == 401


@pytest.mark.django_db
def test_valid_token_creates_user_and_profile(settings_secret, client):
    sub = str(uuid.uuid4())
    resp = auth(client, make_token(sub=sub, email="new@example.com")).get(
        "/api/profile/me/"
    )
    assert resp.status_code == 200
    assert resp.data["email"] == "new@example.com"
    assert resp.data["onboarded"] is False

    profile = Profile.objects.get(supabase_user_id=sub)
    assert profile.user.username == sub
    assert not profile.user.has_usable_password()


@pytest.mark.django_db
def test_same_sub_reuses_the_same_user(settings_secret, client):
    sub = str(uuid.uuid4())
    auth(client, make_token(sub=sub)).get("/api/profile/me/")
    auth(APIClient(), make_token(sub=sub)).get("/api/profile/me/")
    assert User.objects.count() == 1
    assert Profile.objects.count() == 1


@pytest.mark.django_db
def test_expired_token_is_401(settings_secret, client):
    past = datetime.now(tz=timezone.utc) - timedelta(hours=2)
    token = make_token(exp=int(past.timestamp()))
    assert auth(client, token).get("/api/profile/me/").status_code == 401


@pytest.mark.django_db
def test_wrong_signature_is_401(settings_secret, client):
    token = make_token(secret="not-the-real-secret")
    assert auth(client, token).get("/api/profile/me/").status_code == 401


@pytest.mark.django_db
def test_wrong_audience_is_401(settings_secret, client):
    token = make_token(aud="anon")
    assert auth(client, token).get("/api/profile/me/").status_code == 401


@pytest.mark.django_db
def test_garbage_token_is_401(settings_secret, client):
    assert auth(client, "not.a.jwt").get("/api/profile/me/").status_code == 401


@pytest.mark.django_db
def test_missing_server_secret_rejects(settings, client):
    settings.SUPABASE_JWT_SECRET = ""
    assert auth(client, make_token()).get("/api/profile/me/").status_code == 401


# --- Asymmetric (ES256 / JWKS) tokens -------------------------------------
#
# This is what real Supabase projects issue now: tokens signed with a private
# key, verified against the project's published public key. No shared secret is
# involved, so SUPABASE_JWT_SECRET is irrelevant on this path.


@pytest.fixture
def es256_keypair():
    from cryptography.hazmat.primitives.asymmetric import ec

    private_key = ec.generate_private_key(ec.SECP256R1())
    return private_key, private_key.public_key()


def make_es256_token(private_key, kid="test-kid", **overrides):
    now = datetime.now(tz=timezone.utc)
    payload = {
        "sub": str(uuid.uuid4()),
        "email": "ec@example.com",
        "aud": SUPABASE_AUDIENCE,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=1)).timestamp()),
    }
    payload.update(overrides)
    return jwt.encode(payload, private_key, algorithm="ES256", headers={"kid": kid})


@pytest.fixture
def stub_jwks(monkeypatch, es256_keypair):
    """Serve the test public key instead of fetching Supabase's real JWKS."""
    from apps.accounts import authentication as auth_mod

    _, public_key = es256_keypair

    class StubSigningKey:
        key = public_key

    class StubClient:
        def get_signing_key_from_jwt(self, token):
            if jwt.get_unverified_header(token).get("kid") != "test-kid":
                raise jwt.exceptions.PyJWKClientError("no matching kid")
            return StubSigningKey()

    monkeypatch.setattr(auth_mod, "get_jwks_client", lambda url: StubClient())
    return StubClient()


@pytest.mark.django_db
def test_es256_token_authenticates(settings, client, es256_keypair, stub_jwks):
    settings.SUPABASE_URL = "https://example.supabase.co"
    # Deliberately blank: the asymmetric path must not need a shared secret.
    settings.SUPABASE_JWT_SECRET = ""
    private_key, _ = es256_keypair

    sub = str(uuid.uuid4())
    resp = auth(client, make_es256_token(private_key, sub=sub)).get("/api/profile/me/")
    assert resp.status_code == 200
    assert Profile.objects.filter(supabase_user_id=sub).exists()


@pytest.mark.django_db
def test_es256_token_signed_by_wrong_key_is_401(
    settings, client, es256_keypair, stub_jwks
):
    from cryptography.hazmat.primitives.asymmetric import ec

    settings.SUPABASE_URL = "https://example.supabase.co"
    attacker_key = ec.generate_private_key(ec.SECP256R1())
    token = make_es256_token(attacker_key)
    assert auth(client, token).get("/api/profile/me/").status_code == 401


@pytest.mark.django_db
def test_es256_unknown_kid_is_401(settings, client, es256_keypair, stub_jwks):
    settings.SUPABASE_URL = "https://example.supabase.co"
    private_key, _ = es256_keypair
    token = make_es256_token(private_key, kid="rotated-away")
    assert auth(client, token).get("/api/profile/me/").status_code == 401


@pytest.mark.django_db
def test_es256_expired_is_401(settings, client, es256_keypair, stub_jwks):
    settings.SUPABASE_URL = "https://example.supabase.co"
    private_key, _ = es256_keypair
    past = datetime.now(tz=timezone.utc) - timedelta(hours=2)
    token = make_es256_token(private_key, exp=int(past.timestamp()))
    assert auth(client, token).get("/api/profile/me/").status_code == 401


@pytest.mark.django_db
def test_asymmetric_token_rejected_when_supabase_url_missing(
    settings, client, es256_keypair
):
    settings.SUPABASE_URL = ""
    private_key, _ = es256_keypair
    assert (
        auth(client, make_es256_token(private_key)).get("/api/profile/me/").status_code
        == 401
    )


@pytest.mark.django_db
def test_unsupported_algorithm_is_401(settings_secret, client):
    # 'none' algorithm — the classic JWT bypass attempt.
    token = jwt.encode(
        {"sub": str(uuid.uuid4()), "aud": SUPABASE_AUDIENCE, "exp": 9999999999},
        key="",
        algorithm="none",
    )
    assert auth(client, token).get("/api/profile/me/").status_code == 401


# --- Profile update & isolation -------------------------------------------


@pytest.mark.django_db
def test_patch_updates_own_profile(settings_secret, client):
    c = auth(client, make_token())
    resp = c.patch(
        "/api/profile/me/",
        {"display_name": "Asha", "interests": ["hiking", "food"]},
        format="json",
    )
    assert resp.status_code == 200
    assert resp.data["display_name"] == "Asha"
    assert resp.data["interests"] == ["hiking", "food"]


@pytest.mark.django_db
def test_patch_upi_vpa_round_trips(settings_secret, client):
    c = auth(client, make_token())
    resp = c.patch("/api/profile/me/", {"upi_vpa": "asha@okhdfcbank"}, format="json")
    assert resp.status_code == 200
    assert resp.data["upi_vpa"] == "asha@okhdfcbank"


@pytest.mark.django_db
def test_patch_rejects_malformed_upi_vpa(settings_secret, client):
    c = auth(client, make_token())
    resp = c.patch("/api/profile/me/", {"upi_vpa": "not a vpa"}, format="json")
    assert resp.status_code == 400


@pytest.mark.django_db
def test_completeness_reflects_filled_fields(settings_secret, client):
    c = auth(client, make_token())
    empty = c.get("/api/profile/me/").data["completeness"]
    assert empty["percent"] < 100
    assert "a bio" in empty["missing"]

    c.patch(
        "/api/profile/me/",
        {
            "avatar_url": "https://example.com/a.jpg",
            "bio": "I love trains.",
            "travel_styles": ["backpacking"],
            "languages": ["english"],
            "interests": ["food"],
            "daily_budget": 1500,
            "upi_vpa": "asha@okbank",
        },
        format="json",
    )
    full = c.get("/api/profile/me/").data["completeness"]
    assert full == {"percent": 100, "missing": []}


@pytest.mark.django_db
def test_patch_city_regeocodes_area(settings_secret, client, monkeypatch):
    def fake_geocode(query):
        assert query == "Kochi"
        return Point(76.2673, 9.9312, srid=4326), "Kochi, Kerala, India"

    monkeypatch.setattr("apps.accounts.serializers.geocode_city", fake_geocode)

    c = auth(client, make_token())
    resp = c.patch("/api/profile/me/", {"city": "Kochi"}, format="json")
    assert resp.status_code == 200
    assert resp.data["area_label"] == "Kochi, Kerala, India"
    assert resp.data["area"] == {"lat": 9.9312, "lng": 76.2673}
    # `city` is write-only: it must never come back in the payload.
    assert "city" not in resp.data


@pytest.mark.django_db
def test_patch_without_city_keeps_existing_area(settings_secret, client, monkeypatch):
    def boom(query):  # must not be called
        raise AssertionError("geocoder called when no city was submitted")

    monkeypatch.setattr("apps.accounts.serializers.geocode_city", boom)

    c = auth(client, make_token())
    c.get("/api/profile/me/")
    profile = Profile.objects.get(user__email="trav@example.com")
    profile.area_point = Point(77.59, 12.97, srid=4326)
    profile.area_label = "Bengaluru"
    profile.save()

    resp = c.patch("/api/profile/me/", {"display_name": "Asha"}, format="json")
    assert resp.status_code == 200
    assert resp.data["area_label"] == "Bengaluru"
    assert resp.data["area"] == {"lat": 12.97, "lng": 77.59}


@pytest.mark.django_db
def test_patch_blank_city_is_ignored(settings_secret, client, monkeypatch):
    monkeypatch.setattr(
        "apps.accounts.serializers.geocode_city",
        lambda q: (_ for _ in ()).throw(AssertionError("should not geocode")),
    )
    c = auth(client, make_token())
    resp = c.patch(
        "/api/profile/me/", {"city": "", "display_name": "Asha"}, format="json"
    )
    assert resp.status_code == 200
    assert resp.data["display_name"] == "Asha"


@pytest.mark.django_db
def test_patch_unresolvable_city_is_400(settings_secret, client, monkeypatch):
    from apps.accounts.geocoding import GeocodingError

    def boom(query):
        raise GeocodingError("No place found.")

    monkeypatch.setattr("apps.accounts.serializers.geocode_city", boom)

    c = auth(client, make_token())
    resp = c.patch("/api/profile/me/", {"city": "Xyzzy Nowhere"}, format="json")
    assert resp.status_code == 400
    assert "city" in resp.data


@pytest.mark.django_db
def test_invalid_interest_is_rejected(settings_secret, client):
    c = auth(client, make_token())
    resp = c.patch(
        "/api/profile/me/", {"interests": ["not-a-real-tag"]}, format="json"
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_me_returns_only_the_callers_profile(settings_secret):
    sub_a, sub_b = str(uuid.uuid4()), str(uuid.uuid4())
    auth(APIClient(), make_token(sub=sub_a, email="a@x.com")).patch(
        "/api/profile/me/", {"display_name": "A"}, format="json"
    )
    resp = auth(APIClient(), make_token(sub=sub_b, email="b@x.com")).get(
        "/api/profile/me/"
    )
    assert resp.data["email"] == "b@x.com"
    assert resp.data["display_name"] != "A"


@pytest.mark.django_db
def test_public_traveller_view_hides_coordinates(settings_secret):
    # An onboarded traveller with a stored point.
    other = auth(APIClient(), make_token(sub=str(uuid.uuid4()), email="o@x.com"))
    other.get("/api/profile/me/")
    prof = Profile.objects.get(user__email="o@x.com")
    prof.onboarded = True
    prof.area_point = Point(77.59, 12.97, srid=4326)
    prof.area_label = "Bengaluru"
    prof.display_name = "Other"
    prof.save()

    me = auth(APIClient(), make_token(sub=str(uuid.uuid4()), email="me@x.com"))
    resp = me.get(f"/api/travellers/{prof.supabase_user_id}/")
    assert resp.status_code == 200
    body = str(resp.data)
    assert "77.59" not in body and "12.97" not in body
    assert "area_point" not in resp.data and "area" not in resp.data
    assert resp.data["display_name"] == "Other"


@pytest.mark.django_db
def test_email_verified_syncs_from_token_claim(settings_secret):
    sub = str(uuid.uuid4())
    c = auth(APIClient(), make_token(sub=sub, email_verified=False))
    c.get("/api/profile/me/")
    assert Profile.objects.get(supabase_user_id=sub).email_verified is False

    # Same user, later token now claims a verified email.
    c2 = auth(APIClient(), make_token(sub=sub, email_verified=True))
    c2.get("/api/profile/me/")
    assert Profile.objects.get(supabase_user_id=sub).email_verified is True


@pytest.mark.django_db
def test_badges_reflect_verification_completeness_and_activity(settings_secret):
    sub = str(uuid.uuid4())
    c = auth(APIClient(), make_token(sub=sub, email_verified=True))
    c.get("/api/profile/me/")
    profile = Profile.objects.get(supabase_user_id=sub)
    profile.onboarded = True
    profile.bio = "I love trains."
    profile.travel_styles = ["backpacking"]
    profile.save()

    viewer = auth(APIClient(), make_token(email="viewer@x.com"))
    resp = viewer.get(f"/api/travellers/{sub}/")
    assert resp.status_code == 200
    assert set(resp.data["badges"]) == {"email_verified", "profile_complete"}
    assert resp.data["bio"] == "I love trains."
    assert resp.data["travel_styles"] == ["backpacking"]
    assert resp.data["past_destinations"] == []


@pytest.mark.django_db
def test_active_traveller_badge_and_past_destinations_from_finished_trips(settings_secret):
    from datetime import date, timedelta

    from apps.destinations.models import Destination
    from apps.trips.models import Trip

    sub = str(uuid.uuid4())
    c = auth(APIClient(), make_token(sub=sub))
    c.get("/api/profile/me/")
    profile = Profile.objects.get(supabase_user_id=sub)
    profile.onboarded = True
    profile.save()

    dest = Destination.objects.create(
        name="Goa",
        slug="goa-badges-test",
        point=Point(74.12, 15.3, srid=4326),
        avg_daily_budget=1500,
        budget_tier="budget",
    )
    Trip.objects.create(
        owner=profile.user,
        title="Old Goa trip",
        destination=dest,
        start_date=date.today() - timedelta(days=30),
        end_date=date.today() - timedelta(days=25),
    )

    viewer = auth(APIClient(), make_token(email="viewer2@x.com"))
    resp = viewer.get(f"/api/travellers/{sub}/")
    assert resp.status_code == 200
    assert "active_traveller" in resp.data["badges"]
    assert [d["slug"] for d in resp.data["past_destinations"]] == ["goa-badges-test"]


# --- Onboarding (geocoding mocked) ----------------------------------------


@pytest.mark.django_db
def test_onboarding_stores_rounded_point(settings_secret, client, monkeypatch):
    def fake_geocode(query):
        return Point(77.5946, 12.9716, srid=4326), "Bengaluru, Karnataka"

    monkeypatch.setattr("apps.accounts.views.geocode_city", fake_geocode)

    resp = auth(client, make_token()).post(
        "/api/profile/onboarding/",
        {
            "display_name": "Asha",
            "age_band": "21-23",
            "gender": "female",
            "languages": ["english", "hindi"],
            "interests": ["hiking", "food"],
            "budget_style": "budget",
            "daily_budget": 1500,
            "city": "Bengaluru",
        },
        format="json",
    )
    assert resp.status_code == 200
    assert resp.data["onboarded"] is True
    assert resp.data["area_label"] == "Bengaluru, Karnataka"
    assert resp.data["area"] == {"lat": 12.9716, "lng": 77.5946}


@pytest.mark.django_db
def test_onboarding_rejects_bad_city(settings_secret, client, monkeypatch):
    from apps.accounts.geocoding import GeocodingError

    def boom(query):
        raise GeocodingError("No place found.")

    monkeypatch.setattr("apps.accounts.views.geocode_city", boom)
    resp = auth(client, make_token()).post(
        "/api/profile/onboarding/",
        {
            "display_name": "Asha",
            "age_band": "21-23",
            "gender": "female",
            "languages": ["english"],
            "interests": ["hiking"],
            "budget_style": "budget",
            "daily_budget": 1500,
            "city": "Xyzzy Nowhere",
        },
        format="json",
    )
    assert resp.status_code == 422
    assert Profile.objects.get(user__email="trav@example.com").onboarded is False


@pytest.mark.django_db
def test_geocoder_rounds_to_two_dp(monkeypatch):
    from apps.accounts import geocoding

    class FakeResp:
        def raise_for_status(self):
            pass

        def json(self):
            return [{"lat": "12.971598765", "lon": "77.594612345", "display_name": "Bengaluru"}]

    monkeypatch.setattr(geocoding.requests, "get", lambda *a, **k: FakeResp())
    point, label = geocoding.geocode_city("Bengaluru")
    assert point.y == 12.97 and point.x == 77.59
    assert label == "Bengaluru"
