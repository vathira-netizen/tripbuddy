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


def make_dest(slug, lat, lng, budget=1500, tier="budget", tags=None, region="North", state=""):
    return Destination.objects.create(
        name=slug.title(),
        slug=slug,
        point=Point(lng, lat, srid=4326),
        avg_daily_budget=budget,
        budget_tier=tier,
        interest_tags=tags or ["nature"],
        region=region,
        state=state,
    )


# --- Seed command ---------------------------------------------------------


@pytest.mark.django_db
def test_seed_is_idempotent():
    call_command("seed_destinations")
    first = Destination.objects.count()
    assert 30 <= first <= 50
    call_command("seed_destinations")
    assert Destination.objects.count() == first  # no duplicates on re-run


@pytest.mark.django_db
def test_seed_fills_gallery_image_urls():
    call_command("seed_destinations")
    dest = Destination.objects.first()
    assert len(dest.image_urls) == 3
    assert all(dest.slug in url for url in dest.image_urls)


# --- Auth gate ------------------------------------------------------------


@pytest.mark.django_db
def test_list_requires_auth():
    assert APIClient().get("/api/destinations/").status_code == 401


# --- Retrieve by slug -------------------------------------------------------


@pytest.mark.django_db
def test_retrieve_by_slug(client):
    make_dest("goa-detail-test", 15.3, 74.1)
    resp = client.get("/api/destinations/goa-detail-test/")
    assert resp.status_code == 200
    assert resp.data["slug"] == "goa-detail-test"


# --- Reviews ----------------------------------------------------------------


@pytest.mark.django_db
def test_review_create_and_appears_on_destination_aggregate(client):
    dest = make_dest("goa-reviews", 15.3, 74.1)

    resp = client.post(
        "/api/destination-reviews/",
        {"destination": dest.id, "rating": 4, "body": "Loved the beaches."},
        format="json",
    )
    assert resp.status_code == 201
    assert resp.data["rating"] == 4

    listed = client.get(f"/api/destination-reviews/?destination={dest.id}")
    assert len(listed.data["results"]) == 1

    on_dest = client.get("/api/destinations/goa-reviews/")
    assert on_dest.data["avg_rating"] == 4.0
    assert on_dest.data["review_count"] == 1


@pytest.mark.django_db
def test_second_review_from_same_author_edits_not_duplicates(client):
    dest = make_dest("goa-reviews-2", 15.3, 74.1)

    client.post(
        "/api/destination-reviews/",
        {"destination": dest.id, "rating": 2, "body": "Meh."},
        format="json",
    )
    resp = client.post(
        "/api/destination-reviews/",
        {"destination": dest.id, "rating": 5, "body": "Actually great."},
        format="json",
    )
    assert resp.status_code == 201
    assert resp.data["rating"] == 5

    from apps.destinations.models import DestinationReview

    assert DestinationReview.objects.filter(destination=dest).count() == 1


@pytest.mark.django_db
def test_review_delete_requires_authorship(client, settings_secret):
    dest = make_dest("goa-reviews-3", 15.3, 74.1)
    created = client.post(
        "/api/destination-reviews/",
        {"destination": dest.id, "rating": 3},
        format="json",
    )
    review_id = created.data["id"]

    other = APIClient()
    other.credentials(HTTP_AUTHORIZATION=f"Bearer {make_token(email='other@example.com')}")
    assert other.delete(f"/api/destination-reviews/{review_id}/").status_code == 403

    assert client.delete(f"/api/destination-reviews/{review_id}/").status_code == 204


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


@pytest.mark.django_db
def test_state_filter(client):
    make_dest("gokarna", 14.5, 74.3, region="South", state="Karnataka")
    make_dest("goa", 15.3, 74.1, region="West", state="Goa")
    res = client.get("/api/destinations/?state=karnataka")
    assert [d["slug"] for d in res.json()["results"]] == ["gokarna"]
    assert res.json()["results"][0]["state"] == "Karnataka"
