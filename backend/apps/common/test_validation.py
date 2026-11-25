"""Input validation and request limits (the backend is the authority)."""

import uuid
from datetime import date, datetime, timedelta, timezone

import jwt
import pytest
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from django.db import IntegrityError, transaction
from rest_framework.test import APIClient

from apps.accounts.authentication import SUPABASE_AUDIENCE
from apps.accounts.models import Profile
from apps.common.throttling import WriteScopedThrottle
from apps.connections.models import Connection
from apps.destinations.models import Destination
from apps.trips.models import Trip

User = get_user_model()
SECRET = "test-jwt-secret"
STORAGE = "https://proj.supabase.co/storage/v1/object/public/"


@pytest.fixture(autouse=True)
def _settings(settings):
    settings.SUPABASE_JWT_SECRET = SECRET
    settings.SUPABASE_URL = "https://proj.supabase.co"


def traveller(name):
    user = User.objects.create_user(username=name)
    profile = Profile.objects.create(
        user=user, supabase_user_id=uuid.uuid4(), display_name=name.title(), onboarded=True
    )
    now = datetime.now(tz=timezone.utc)
    token = jwt.encode(
        {
            "sub": str(profile.supabase_user_id),
            "email": f"{name}@example.com",
            "aud": SUPABASE_AUDIENCE,
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(hours=1)).timestamp()),
        },
        SECRET,
        algorithm="HS256",
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return user, client


@pytest.fixture
def limits(monkeypatch):
    """Shrink the scoped limits so a test can hit them in a few requests."""
    def set_rates(**rates):
        monkeypatch.setattr(WriteScopedThrottle, "THROTTLE_RATES", rates)
    return set_rates


# --- Trips -------------------------------------------------------------------


@pytest.mark.django_db
def test_trip_cannot_end_before_it_starts():
    user, c = traveller("asha")
    bad = c.post(
        "/api/trips/",
        {"title": "Coorg", "start_date": "2027-01-10", "end_date": "2027-01-08"},
        format="json",
    )
    assert bad.status_code == 400 and "end_date" in bad.data

    trip_id = c.post(
        "/api/trips/", {"title": "Coorg", "start_date": "2027-01-10"}, format="json"
    ).data["id"]
    # A PATCH of one date is checked against the stored other one.
    assert c.patch(f"/api/trips/{trip_id}/", {"end_date": "2027-01-01"}, format="json").status_code == 400
    assert c.patch(f"/api/trips/{trip_id}/", {"end_date": "2027-01-12"}, format="json").status_code == 200

    assert c.post("/api/trips/", {"title": "   "}, format="json").status_code == 400


@pytest.mark.django_db
def test_database_refuses_backwards_trip_even_without_the_api():
    user, _ = traveller("asha")
    with pytest.raises(IntegrityError), transaction.atomic():
        Trip.objects.create(
            owner=user, title="x", start_date=date(2027, 1, 10), end_date=date(2027, 1, 1)
        )


@pytest.mark.django_db
def test_images_must_come_from_our_storage():
    user, c = traveller("asha")
    trip_id = c.post("/api/trips/", {"title": "Goa"}, format="json").data["id"]
    for field, url in (
        ("cover_image_url", f"/api/trips/{trip_id}/"),
        ("avatar_url", "/api/profile/me/"),
    ):
        assert c.patch(url, {field: "https://evil.example/pixel.gif"}, format="json").status_code == 400
        assert c.patch(url, {field: STORAGE + "x/a.jpg"}, format="json").status_code == 200
        assert c.patch(url, {field: ""}, format="json").status_code == 200


# --- Budget ------------------------------------------------------------------


@pytest.mark.django_db
def test_budget_amount_must_be_positive_and_sane():
    user, c = traveller("asha")
    trip_id = c.post("/api/trips/", {"title": "Goa"}, format="json").data["id"]

    def add(amount, label="Bus"):
        return c.post(
            "/api/budget-items/",
            {"trip": trip_id, "category": "Transport", "label": label, "amount": amount},
            format="json",
        )

    assert add("0").status_code == 400
    assert add("-50").status_code == 400
    assert add("1000001").status_code == 400
    assert add("450", label="  ").status_code == 400
    assert add("450").status_code == 201


# --- Reviews -----------------------------------------------------------------


@pytest.mark.django_db
def test_review_length_is_capped():
    dest = Destination.objects.create(
        name="Hampi", slug="hampi-v", point=Point(76.4, 15.3, srid=4326),
        avg_daily_budget=1200, budget_tier="budget",
    )
    _, c = traveller("asha")
    long = c.post(
        "/api/destination-reviews/",
        {"destination": dest.id, "rating": 4, "body": "a" * 1001},
        format="json",
    )
    assert long.status_code == 400
    ok = c.post(
        "/api/destination-reviews/",
        {"destination": dest.id, "rating": 4, "body": "  Loved the boulders.  "},
        format="json",
    )
    assert ok.status_code in (200, 201) and ok.data["body"] == "Loved the boulders."


# --- Request limits ----------------------------------------------------------


@pytest.mark.django_db
def test_sending_messages_is_limited_but_reading_is_not(limits):
    limits(messages="2/min")
    a, ca = traveller("asha")
    b, _ = traveller("bina")
    conn = Connection.objects.create(requester=a, addressee=b, status=Connection.Status.ACCEPTED)
    url = f"/api/connections/{conn.pk}/messages/"

    assert ca.post(url, {"body": "one"}, format="json").status_code == 201
    assert ca.post(url, {"body": "two"}, format="json").status_code == 201
    third = ca.post(url, {"body": "three"}, format="json")
    assert third.status_code == 429
    assert third.data["detail"].startswith("You're doing that too often")
    # Polling the thread still works.
    for _ in range(5):
        assert ca.get(url).status_code == 200


@pytest.mark.django_db
def test_ai_calls_are_limited(limits):
    limits(ai="1/hour")
    _, c = traveller("asha")
    trip_id = c.post("/api/trips/", {"title": "Goa"}, format="json").data["id"]
    url = f"/api/trips/{trip_id}/generate-itinerary/"
    # No LLM key in tests, so the first call is a 503 — but it still counts.
    assert c.post(url, {}, format="json").status_code != 429
    assert c.post(url, {}, format="json").status_code == 429
    # Other trip writes aren't affected by the AI limit.
    assert c.patch(f"/api/trips/{trip_id}/", {"title": "Goa 2"}, format="json").status_code == 200


@pytest.mark.django_db
def test_join_requests_are_limited_but_answering_is_not(limits):
    limits(join_requests="1/hour")
    owner, co = traveller("owner")
    _, c1 = traveller("one")
    _, c2 = traveller("two")
    ids = []
    for title in ("A", "B"):
        tid = co.post("/api/trips/", {"title": title}, format="json").data["id"]
        co.post(f"/api/trips/{tid}/open-to-join/")
        ids.append(tid)

    first = c1.post("/api/trip-join-requests/", {"trip": ids[0]}, format="json")
    assert first.status_code == 201
    assert c1.post("/api/trip-join-requests/", {"trip": ids[1]}, format="json").status_code == 429

    # A different traveller has their own allowance, and the owner can answer
    # any number of requests.
    second = c2.post("/api/trip-join-requests/", {"trip": ids[0]}, format="json")
    assert second.status_code == 201
    assert co.post(f"/api/trip-join-requests/{first.data['id']}/accept/").status_code == 200
    assert co.post(f"/api/trip-join-requests/{second.data['id']}/decline/").status_code == 200
