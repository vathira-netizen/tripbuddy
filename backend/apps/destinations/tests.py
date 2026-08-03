import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from django.contrib.gis.geos import Point
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.accounts.authentication import SUPABASE_AUDIENCE
from apps.destinations.models import Destination, SavedDestination

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


def make_dest(slug, lat, lng, budget=1500, tier="budget", tags=None, region="North"):
    return Destination.objects.create(
        name=slug.title(),
        slug=slug,
        point=Point(lng, lat, srid=4326),
        avg_daily_budget=budget,
        budget_tier=tier,
        interest_tags=tags or ["nature"],
        region=region,
    )


# --- Seed command ---------------------------------------------------------


@pytest.mark.django_db
def test_seed_is_idempotent():
    call_command("seed_destinations")
    first = Destination.objects.count()
    assert 30 <= first <= 50
    call_command("seed_destinations")
    assert Destination.objects.count() == first  # no duplicates on re-run


# --- Auth gate ------------------------------------------------------------


@pytest.mark.django_db
def test_list_requires_auth():
    assert APIClient().get("/api/destinations/").status_code == 401


# --- Filtering & ordering -------------------------------------------------


@pytest.mark.django_db
def test_budget_and_interest_filters(client):
    make_dest("cheap-beach", 15, 74, budget=800, tags=["beach", "food"])
    make_dest("pricey-hike", 32, 77, budget=3000, tags=["hiking"])

    resp = client.get("/api/destinations/?max_budget=1000")
    slugs = [d["slug"] for d in resp.data["results"]]
    assert slugs == ["cheap-beach"]

    resp = client.get("/api/destinations/?interests=hiking")
    slugs = [d["slug"] for d in resp.data["results"]]
    assert slugs == ["pricey-hike"]


@pytest.mark.django_db
def test_ordering_by_budget(client):
    make_dest("b", 15, 74, budget=2000)
    make_dest("a", 16, 75, budget=500)
    resp = client.get("/api/destinations/?ordering=avg_daily_budget")
    budgets = [d["avg_daily_budget"] for d in resp.data["results"]]
    assert budgets == sorted(budgets)


# --- Nearby (PostGIS) -----------------------------------------------------


@pytest.mark.django_db
def test_nearby_orders_by_distance_and_respects_radius(client):
    # Goa area origin.
    make_dest("near", 15.30, 74.12)   # ~same spot
    make_dest("mid", 15.34, 76.46)    # Hampi-ish, a couple hundred km
    make_dest("far", 34.15, 77.57)    # Leh, >1500km

    resp = client.get("/api/destinations/nearby/?lat=15.30&lng=74.12&radius_km=500")
    slugs = [d["slug"] for d in resp.data]
    assert slugs[0] == "near"
    assert "far" not in slugs  # outside radius
    assert resp.data[0]["distance_km"] is not None


# --- Saved list -----------------------------------------------------------


@pytest.mark.django_db
def test_save_list_and_delete(client):
    dest = make_dest("goa", 15.3, 74.1)

    resp = client.post("/api/saved-destinations/", {"destination_id": dest.id}, format="json")
    assert resp.status_code == 201

    # Saving again is a no-op, not a duplicate/500.
    client.post("/api/saved-destinations/", {"destination_id": dest.id}, format="json")
    assert SavedDestination.objects.count() == 1

    resp = client.get("/api/saved-destinations/")
    assert resp.data["results"][0]["destination"]["slug"] == "goa"

    saved_id = resp.data["results"][0]["id"]
    assert client.delete(f"/api/saved-destinations/{saved_id}/").status_code == 204
    assert SavedDestination.objects.count() == 0


@pytest.mark.django_db
def test_saved_list_is_per_user(settings_secret):
    dest = make_dest("goa", 15.3, 74.1)
    other = APIClient()
    other.credentials(HTTP_AUTHORIZATION=f"Bearer {make_token(email='a@x.com')}")
    other.post("/api/saved-destinations/", {"destination_id": dest.id}, format="json")

    me = APIClient()
    me.credentials(HTTP_AUTHORIZATION=f"Bearer {make_token(email='b@x.com')}")
    assert me.get("/api/saved-destinations/").data["results"] == []
