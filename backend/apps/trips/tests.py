import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import jwt
import pytest
from rest_framework.test import APIClient

from apps.accounts.authentication import SUPABASE_AUDIENCE
from apps.trips.models import Trip

SECRET = "test-jwt-secret"


def make_token(sub=None, email="trav@example.com"):
    now = datetime.now(tz=timezone.utc)
    return jwt.encode(
        {
            "sub": sub or str(uuid.uuid4()),
            "email": email,
            "aud": SUPABASE_AUDIENCE,
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(hours=1)).timestamp()),
        },
        SECRET,
        algorithm="HS256",
    )


@pytest.fixture
def settings_secret(settings):
    settings.SUPABASE_JWT_SECRET = SECRET
    return settings


@pytest.fixture
def client(settings_secret):
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {make_token()}")
    return c


@pytest.mark.django_db
def test_create_requires_auth():
    resp = APIClient().post("/api/trips/", {"title": "Goa run"}, format="json")
    assert resp.status_code == 401


@pytest.mark.django_db
def test_create_trip_sets_owner(client):
    resp = client.post("/api/trips/", {"title": "Goa run"}, format="json")
    assert resp.status_code == 201
    trip = Trip.objects.get(pk=resp.data["id"])
    assert trip.title == "Goa run"
    assert trip.owner.email == "trav@example.com"


@pytest.mark.django_db
def test_list_is_scoped_to_own_trips(client):
    client.post("/api/trips/", {"title": "Mine"}, format="json")

    other = APIClient()
    other.credentials(HTTP_AUTHORIZATION=f"Bearer {make_token(email='other@example.com')}")
    other.post("/api/trips/", {"title": "Theirs"}, format="json")

    titles = [t["title"] for t in client.get("/api/trips/").data["results"]]
    assert titles == ["Mine"]


# --- Budget summary / CSV ---------------------------------------------------


@pytest.mark.django_db
def test_budget_summary_shape(client):
    trip_id = client.post(
        "/api/trips/", {"title": "Goa run", "target_amount": "300"}, format="json"
    ).data["id"]
    client.post(
        "/api/budget-items/",
        {"trip": trip_id, "category": "Food", "label": "Lunch", "amount": "100"},
        format="json",
    )

    resp = client.get(f"/api/trips/{trip_id}/budget-summary/")
    assert resp.status_code == 200
    assert resp.data["category_totals"]["Food"] == Decimal("100.00")
    assert resp.data["running_total"] == {
        "total": Decimal("100.00"),
        "target": Decimal("300.00"),
        "remaining": Decimal("200.00"),
        "over_budget": False,
    }
    assert resp.data["per_person"]["equal_share"] == Decimal("100.00")


@pytest.mark.django_db
def test_budget_summary_requires_trip_membership(client):
    other = APIClient()
    other.credentials(HTTP_AUTHORIZATION=f"Bearer {make_token(email='other@example.com')}")
    trip_id = other.post("/api/trips/", {"title": "Theirs"}, format="json").data["id"]

    resp = client.get(f"/api/trips/{trip_id}/budget-summary/")
    assert resp.status_code == 404  # scoped out of the queryset, not just forbidden


@pytest.mark.django_db
def test_budget_csv_export(client):
    trip_id = client.post("/api/trips/", {"title": "Goa run"}, format="json").data["id"]
    client.post(
        "/api/budget-items/",
        {"trip": trip_id, "category": "Stay", "label": "Hostel", "amount": "500"},
        format="json",
    )

    resp = client.get(f"/api/trips/{trip_id}/budget.csv/")
    assert resp.status_code == 200
    assert resp["Content-Type"] == "text/csv"
    body = resp.content.decode()
    assert "category,label,amount,payer_email,created_at" in body
    assert "Stay,Hostel,500" in body
