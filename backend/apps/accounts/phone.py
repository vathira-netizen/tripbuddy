"""Confirming a user's phone number with Supabase.

The access token's ``phone`` claim is the user's *stored* number, and Supabase
can store a number before it is confirmed (a direct phone sign-up does). A
number added through ``updateUser({ phone })`` only moves into that field after
the SMS code is verified, but the token carries no "confirmed" flag either way.

So a ``phone`` claim is only a reason to ask: before marking a profile
phone-verified we look the user up with Supabase's admin API and require a
``phone_confirmed_at``. This happens once per user (the flag is upgrade-only),
uses the service-role key that already lives in the backend's environment, and
never stores or logs the number.
"""

import logging

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 5


def phone_confirmed_in_supabase(supabase_user_id) -> bool:
    """True only if Supabase reports a confirmed phone number for this user.

    Any failure (no key configured, network error, unexpected reply) answers
    False: the user simply isn't upgraded yet and the next request asks again.
    """
    base = (settings.SUPABASE_URL or "").rstrip("/")
    key = settings.SUPABASE_SERVICE_ROLE_KEY
    if not base or not key:
        logger.error(
            "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set; "
            "cannot confirm phone numbers."
        )
        return False

    try:
        response = requests.get(
            f"{base}/auth/v1/admin/users/{supabase_user_id}",
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        logger.warning("Phone confirmation lookup failed: %s", type(exc).__name__)
        return False

    if response.status_code != 200:
        logger.warning("Phone confirmation lookup returned %s", response.status_code)
        return False

    try:
        data = response.json()
    except ValueError:
        return False
    return bool(data.get("phone") and data.get("phone_confirmed_at"))
