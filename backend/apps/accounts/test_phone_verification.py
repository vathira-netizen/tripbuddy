"""Phone verification: syncing the flag from Supabase, and gating buddy features.

Supabase is the only place a phone number lives. Django keeps one boolean,
``Profile.phone_verified``, upgraded when a token carries a ``phone`` claim and
Supabase's admin API confirms that number (see apps.accounts.phone).
"""

import uuid

import pytest
import requests
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.accounts import authentication
from apps.accounts.badges import compute_badges
from apps.accounts.models import Profile
from apps.accounts.phone import phone_confirmed_in_supabase
from apps.accounts.tests import SECRET, make_token
from apps.connections.models import Connection
from apps.destinations.models import Destination
from apps.messaging.models import Message

User = get_user_model()

PHONE = "+919876543210"
BLR = (12.97, 77.59)
CODE = "phone_verification_required"


@pytest.fixture
def settings_secret(settings):
    settings.SUPABASE_JWT_SECRET = SECRET
    return settings


@pytest.fixture
def supabase(monkeypatch):
    """Stands in for Supabase's admin lookup. Set ``.confirmed``; read ``.calls``."""

    class FakeSupabase:
        confirmed = True
        calls = 0

        def lookup(self, supabase_user_id):
            self.calls += 1
            return self.confirmed

    fake = FakeSupabase()
    monkeypatch.setattr(authentication, "phone_confirmed_in_supabase", fake.lookup)
    return fake


def make_traveller(username, *, phone_verified, at=BLR):
    user = User.objects.create_user(username=username)
    profile = Profile.objects.create(
        user=user,
        supabase_user_id=uuid.uuid4(),
        display_name=username.title(),
        onboarded=True,
        phone_verified=phone_verified,
        interests=["trekking"],
        languages=["english"],
        budget_style="budget",
        age_band="21-23",
        gender="female",
        area_label="Bengaluru",
        area_point=Point(at[1], at[0], srid=4326),
    )
    return user, profile


def client_for(profile, **claims):
    c = APIClient()
    token = make_token(sub=str(profile.supabase_user_id), **claims)
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return c


def me(profile, **claims):
    return client_for(profile, **claims).get("/api/profile/me/")


# --- Syncing the flag from the token ----------------------------------------


@pytest.mark.django_db
def test_confirmed_phone_claim_marks_the_profile_verified(settings_secret, supabase):
    _, profile = make_traveller("asha", phone_verified=False)

    response = me(profile, phone=PHONE)

    assert response.status_code == 200
    assert response.data["phone_verified"] is True
    profile.refresh_from_db()
    assert profile.phone_verified is True
    assert supabase.calls == 1


@pytest.mark.django_db
def test_no_phone_claim_leaves_the_profile_unverified(settings_secret, supabase):
    _, profile = make_traveller("asha", phone_verified=False)

    assert me(profile).data["phone_verified"] is False
    assert me(profile, phone="").data["phone_verified"] is False
    assert supabase.calls == 0  # nothing to check without a claim


@pytest.mark.django_db
def test_a_token_without_the_claim_never_unverifies(settings_secret, supabase):
    _, profile = make_traveller("asha", phone_verified=True)

    assert me(profile).data["phone_verified"] is True
    profile.refresh_from_db()
    assert profile.phone_verified is True


@pytest.mark.django_db
def test_a_phone_claim_supabase_has_not_confirmed_is_not_trusted(settings_secret, supabase):
    # e.g. a direct phone sign-up: the number is stored before it's confirmed.
    supabase.confirmed = False
    _, profile = make_traveller("asha", phone_verified=False)

    assert me(profile, phone=PHONE).data["phone_verified"] is False
    profile.refresh_from_db()
    assert profile.phone_verified is False


@pytest.mark.django_db
def test_an_unconfirmed_claim_is_rechecked_at_most_once_a_minute(settings_secret, supabase):
    supabase.confirmed = False
    _, profile = make_traveller("asha", phone_verified=False)

    for _ in range(3):
        me(profile, phone=PHONE)

    assert supabase.calls == 1


@pytest.mark.django_db
def test_newly_verified_user_is_recognised_on_the_next_request_despite_the_cache(
    settings_secret, supabase
):
    _, profile = make_traveller("asha", phone_verified=False)

    # First request (before verifying) puts the user in the per-process cache.
    assert me(profile).data["phone_verified"] is False
    assert authentication.cache.get(f"sb-user:{profile.supabase_user_id}") is not None

    # Verified in Supabase, session refreshed: the very next token has `phone`.
    response = client_for(profile, phone=PHONE).get("/api/buddies/")

    assert response.status_code == 200
    profile.refresh_from_db()
    assert profile.phone_verified is True


@pytest.mark.django_db
def test_verified_users_do_not_trigger_a_lookup_on_every_request(settings_secret, supabase):
    _, profile = make_traveller("asha", phone_verified=True)

    for _ in range(3):
        me(profile, phone=PHONE)

    assert supabase.calls == 0


# --- Asking Supabase -------------------------------------------------------------


class FakeResponse:
    def __init__(self, status_code, data):
        self.status_code = status_code
        self._data = data

    def json(self):
        return self._data


@pytest.fixture
def supabase_settings(settings):
    settings.SUPABASE_URL = "https://example.supabase.co"
    settings.SUPABASE_SERVICE_ROLE_KEY = "service-key"
    return settings


@pytest.mark.parametrize(
    ("reply", "expected"),
    [
        (FakeResponse(200, {"phone": "919876543210", "phone_confirmed_at": "2026-11-25T10:00:00Z"}), True),
        (FakeResponse(200, {"phone": "919876543210", "phone_confirmed_at": None}), False),
        (FakeResponse(200, {"phone": "", "phone_confirmed_at": None}), False),
        (FakeResponse(404, {}), False),
    ],
)
def test_lookup_requires_a_confirmed_number(monkeypatch, supabase_settings, reply, expected):
    seen = {}

    def fake_get(url, headers, timeout):
        seen["url"] = url
        return reply

    monkeypatch.setattr(requests, "get", fake_get)
    user_id = uuid.uuid4()

    assert phone_confirmed_in_supabase(user_id) is expected
    assert seen["url"] == f"https://example.supabase.co/auth/v1/admin/users/{user_id}"


def test_lookup_answers_no_when_supabase_is_unreachable(monkeypatch, supabase_settings):
    def boom(*args, **kwargs):
        raise requests.ConnectionError("down")

    monkeypatch.setattr(requests, "get", boom)
    assert phone_confirmed_in_supabase(uuid.uuid4()) is False


def test_lookup_answers_no_without_a_service_key(settings):
    settings.SUPABASE_URL = "https://example.supabase.co"
    settings.SUPABASE_SERVICE_ROLE_KEY = ""
    assert phone_confirmed_in_supabase(uuid.uuid4()) is False


# --- What other travellers see ------------------------------------------------------


@pytest.mark.django_db
def test_badge_shows_phone_verified_and_nothing_else_leaks(settings_secret, supabase):
    _, viewer = make_traveller("viewer", phone_verified=True)
    _, verified = make_traveller("verified", phone_verified=True)
    _, unverified = make_traveller("unverified", phone_verified=False)

    assert "phone_verified" in compute_badges(verified)
    assert "phone_verified" not in compute_badges(unverified)

    public = client_for(viewer).get(f"/api/travellers/{verified.supabase_user_id}/").data
    assert "phone_verified" in public["badges"]
    assert "phone_verified" not in public
    assert not any("phone" in key for key in public if key != "badges")


# --- Gated endpoints ----------------------------------------------------------------


def assert_needs_phone(response):
    assert response.status_code == 403
    assert response.data["code"] == CODE


@pytest.mark.django_db
def test_buddy_search_needs_a_verified_phone(settings_secret, supabase):
    _, unverified = make_traveller("asha", phone_verified=False)
    _, verified = make_traveller("bina", phone_verified=True)

    assert_needs_phone(client_for(unverified).get("/api/buddies/"))
    assert client_for(verified).get("/api/buddies/").status_code == 200


@pytest.mark.django_db
def test_sending_a_request_needs_a_verified_phone(settings_secret, supabase):
    _, unverified = make_traveller("asha", phone_verified=False)
    _, verified = make_traveller("bina", phone_verified=True)
    _, target = make_traveller("chitra", phone_verified=True)
    body = {"supabase_user_id": str(target.supabase_user_id)}

    assert_needs_phone(client_for(unverified).post("/api/connections/", body, format="json"))
    assert Connection.objects.count() == 0
    assert client_for(verified).post("/api/connections/", body, format="json").status_code == 201


@pytest.mark.django_db
def test_accepting_needs_a_verified_phone_but_declining_and_blocking_do_not(
    settings_secret, supabase
):
    sender_user, _ = make_traveller("asha", phone_verified=True)
    me_user, me_profile = make_traveller("bina", phone_verified=False)
    connection = Connection.objects.create(requester=sender_user, addressee=me_user)
    c = client_for(me_profile)

    assert_needs_phone(c.post(f"/api/connections/{connection.pk}/accept/"))
    connection.refresh_from_db()
    assert connection.status == Connection.Status.PENDING

    # Saying no and blocking are safety actions: always available.
    assert c.post(f"/api/connections/{connection.pk}/decline/").status_code == 200
    assert c.post(f"/api/connections/{connection.pk}/block/").status_code == 200


@pytest.mark.django_db
def test_verified_user_can_accept(settings_secret, supabase):
    sender_user, _ = make_traveller("asha", phone_verified=True)
    me_user, me_profile = make_traveller("bina", phone_verified=True)
    connection = Connection.objects.create(requester=sender_user, addressee=me_user)

    response = client_for(me_profile).post(f"/api/connections/{connection.pk}/accept/")

    assert response.status_code == 200
    assert response.data["status"] == Connection.Status.ACCEPTED


@pytest.mark.django_db
def test_unverified_user_reads_old_messages_but_cannot_send(settings_secret, supabase):
    alice_user, alice = make_traveller("alice", phone_verified=True)
    bob_user, bob = make_traveller("bob", phone_verified=False)
    connection = Connection.objects.create(
        requester=alice_user, addressee=bob_user, status=Connection.Status.ACCEPTED
    )
    Message.objects.create(connection=connection, sender=alice_user, body="Hi Bob")
    url = f"/api/connections/{connection.pk}/messages/"

    history = client_for(bob).get(url)
    assert history.status_code == 200
    assert [m["body"] for m in history.data["results"]] == ["Hi Bob"]

    assert_needs_phone(client_for(bob).post(url, {"body": "Hello"}, format="json"))
    assert Message.objects.count() == 1
    assert client_for(alice).post(url, {"body": "Still there?"}, format="json").status_code == 201


@pytest.mark.django_db
def test_signed_out_requests_are_still_401(settings_secret):
    assert APIClient().get("/api/buddies/").status_code == 401
    assert APIClient().post("/api/connections/", {}, format="json").status_code == 401


# --- Who appears as a buddy -------------------------------------------------------------


@pytest.mark.django_db
def test_unverified_travellers_never_appear_as_candidates(settings_secret, supabase):
    _, searcher = make_traveller("searcher", phone_verified=True)
    _, verified = make_traveller("verified", phone_verified=True)
    _, unverified = make_traveller("unverified", phone_verified=False)

    results = client_for(searcher).get("/api/buddies/").data["results"]
    ids = {r["supabase_user_id"] for r in results}

    assert str(verified.supabase_user_id) in ids
    assert str(unverified.supabase_user_id) not in ids


@pytest.mark.django_db
def test_seeded_demo_buddies_count_as_verified(settings):
    settings.DEBUG = True
    Destination.objects.create(
        name="Coorg",
        slug="coorg",
        point=Point(75.8, 12.4, srid=4326),
        avg_daily_budget=1500,
        budget_tier="budget",
        interest_tags=["nature"],
        region="South",
    )
    call_command("seed_pilot", profiles=4, connections=0, trips=0)

    seeded = Profile.objects.filter(user__username__startswith="pilot-")
    assert seeded.exists()
    assert not seeded.filter(phone_verified=False).exists()
