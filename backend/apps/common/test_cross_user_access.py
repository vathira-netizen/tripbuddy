"""Every user-scoped endpoint, attacked from a second account.

The rule this suite pins: knowing an object's id must never be enough to reach
it. Each app already tests its own happy path; this walks the whole API surface
from an *outsider's* position, so a new endpoint that forgets scoping shows up
here rather than in production.

Two layers have to hold, and they fail differently:

* the **queryset filter** hides other people's rows from list and detail views,
  which is why an outsider usually gets 404 rather than 403 — the object is not
  merely forbidden, it is invisible;
* the **permission class** catches anything the filter cannot, such as a
  guessed pk on a viewset that does not scope, or a write that names a foreign
  parent in its payload.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import jwt
import pytest
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from rest_framework.test import APIClient

from apps.accounts.authentication import SUPABASE_AUDIENCE
from apps.accounts.models import Profile
from apps.budgets.models import BudgetItem
from apps.connections.models import Connection
from apps.destinations.models import Destination, SavedDestination
from apps.trips.models import ItineraryItem, Trip

User = get_user_model()
SECRET = "test-jwt-secret"
BLR = (12.97, 77.59)


def token_for(profile):
    now = datetime.now(tz=timezone.utc)
    return jwt.encode(
        {
            "sub": str(profile.supabase_user_id),
            "email": f"{profile.display_name}@example.com",
            "aud": SUPABASE_AUDIENCE,
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(hours=1)).timestamp()),
        },
        SECRET,
        algorithm="HS256",
    )


@pytest.fixture
def secret(settings):
    settings.SUPABASE_JWT_SECRET = SECRET
    return settings


def make_traveller(username):
    user = User.objects.create_user(username=username)
    profile = Profile.objects.create(
        user=user,
        supabase_user_id=uuid.uuid4(),
        display_name=username,
        interests=["food"],
        languages=["english"],
        budget_style="budget",
        age_band="21-23",
        gender="female",
        area_label=f"{username} city",
        area_point=Point(BLR[1], BLR[0], srid=4326),
        onboarded=True,
        phone_verified=True,
    )
    return user, profile


def client_for(profile):
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {token_for(profile)}")
    return c


@pytest.fixture
def owner_and_outsider(secret):
    owner_user, owner = make_traveller("owner")
    outsider_user, outsider = make_traveller("outsider")
    return (owner_user, owner), (outsider_user, outsider)


@pytest.fixture
def owned_trip(owner_and_outsider):
    (owner_user, _), _ = owner_and_outsider
    destination = Destination.objects.create(
        name="Goa", slug="goa", point=Point(74.12, 15.29, srid=4326),
        avg_daily_budget=2500, budget_tier="mid", interest_tags=["beach"], region="West",
    )
    trip = Trip.objects.create(
        owner=owner_user, title="Owner's trip", destination=destination,
        start_date=date(2026, 3, 1), end_date=date(2026, 3, 5),
        target_amount=Decimal("20000"),
    )
    item = ItineraryItem.objects.create(trip=trip, day_index=0, position=0, title="Beach")
    budget = BudgetItem.objects.create(
        trip=trip, category="Food", label="Dinner", amount=Decimal("1200"), payer=owner_user
    )
    return trip, item, budget, destination


# --- trips ---------------------------------------------------------------


@pytest.mark.django_db
def test_outsider_cannot_read_or_change_a_trip(owner_and_outsider, owned_trip):
    _, (_, outsider) = owner_and_outsider
    trip, _, _, _ = owned_trip
    client = client_for(outsider)

    assert client.get(f"/api/trips/{trip.pk}/").status_code == 404
    assert client.patch(f"/api/trips/{trip.pk}/", {"title": "hijacked"}, format="json").status_code == 404
    assert client.delete(f"/api/trips/{trip.pk}/").status_code == 404

    trip.refresh_from_db()
    assert trip.title == "Owner's trip"


@pytest.mark.django_db
def test_outsider_trip_list_is_empty(owner_and_outsider, owned_trip):
    _, (_, outsider) = owner_and_outsider
    assert client_for(outsider).get("/api/trips/").data["results"] == []


@pytest.mark.django_db
def test_outsider_cannot_share_or_unshare_someone_elses_trip(owner_and_outsider, owned_trip):
    _, (_, outsider) = owner_and_outsider
    trip, _, _, _ = owned_trip
    client = client_for(outsider)

    assert client.post(f"/api/trips/{trip.pk}/share/").status_code == 404
    trip.refresh_from_db()
    assert trip.is_public is False


# --- itinerary -----------------------------------------------------------


@pytest.mark.django_db
def test_outsider_cannot_touch_an_itinerary_item(owner_and_outsider, owned_trip):
    _, (_, outsider) = owner_and_outsider
    _, item, _, _ = owned_trip
    client = client_for(outsider)

    assert client.get(f"/api/itinerary-items/{item.pk}/").status_code == 404
    assert client.patch(f"/api/itinerary-items/{item.pk}/", {"title": "x"}, format="json").status_code == 404
    assert client.delete(f"/api/itinerary-items/{item.pk}/").status_code == 404

    item.refresh_from_db()
    assert item.title == "Beach"


@pytest.mark.django_db
def test_outsider_cannot_add_an_item_to_a_foreign_trip(owner_and_outsider, owned_trip):
    _, (_, outsider) = owner_and_outsider
    trip, _, _, _ = owned_trip

    response = client_for(outsider).post(
        "/api/itinerary-items/",
        {"trip": trip.pk, "day_index": 0, "position": 9, "title": "smuggled"},
        format="json",
    )
    assert response.status_code == 400
    assert not ItineraryItem.objects.filter(title="smuggled").exists()


# --- budgets -------------------------------------------------------------


@pytest.mark.django_db
def test_outsider_cannot_touch_a_budget_item(owner_and_outsider, owned_trip):
    _, (_, outsider) = owner_and_outsider
    _, _, budget, _ = owned_trip
    client = client_for(outsider)

    assert client.get(f"/api/budget-items/{budget.pk}/").status_code == 404
    assert client.patch(f"/api/budget-items/{budget.pk}/", {"amount": "1"}, format="json").status_code == 404
    assert client.delete(f"/api/budget-items/{budget.pk}/").status_code == 404

    budget.refresh_from_db()
    assert budget.amount == Decimal("1200")


@pytest.mark.django_db
def test_outsider_cannot_add_a_budget_item_to_a_foreign_trip(owner_and_outsider, owned_trip):
    _, (_, outsider) = owner_and_outsider
    trip, _, _, _ = owned_trip

    response = client_for(outsider).post(
        "/api/budget-items/",
        {"trip": trip.pk, "category": "Food", "label": "smuggled", "amount": "10"},
        format="json",
    )
    assert response.status_code == 400
    assert not BudgetItem.objects.filter(label="smuggled").exists()


@pytest.mark.django_db
def test_outsider_cannot_read_a_foreign_budget_summary(owner_and_outsider, owned_trip):
    _, (_, outsider) = owner_and_outsider
    trip, _, _, _ = owned_trip

    assert client_for(outsider).get(f"/api/trips/{trip.pk}/budget-summary/").status_code == 404


# --- saved destinations --------------------------------------------------


@pytest.mark.django_db
def test_outsider_cannot_delete_someone_elses_saved_destination(owner_and_outsider, owned_trip):
    (owner_user, _), (_, outsider) = owner_and_outsider
    _, _, _, destination = owned_trip
    saved = SavedDestination.objects.create(user=owner_user, destination=destination)

    client = client_for(outsider)
    assert client.delete(f"/api/saved-destinations/{saved.pk}/").status_code == 404
    assert client.get("/api/saved-destinations/").data["results"] == []
    assert SavedDestination.objects.filter(pk=saved.pk).exists()


# --- catalogue is read-only ---------------------------------------------


@pytest.mark.django_db
def test_the_destination_catalogue_is_not_writable(owner_and_outsider, owned_trip):
    _, (_, outsider) = owner_and_outsider
    _, _, _, destination = owned_trip
    client = client_for(outsider)

    for method, path in (
        ("post", "/api/destinations/"),
        ("patch", f"/api/destinations/{destination.pk}/"),
        ("delete", f"/api/destinations/{destination.pk}/"),
    ):
        response = getattr(client, method)(path, {}, format="json")
        assert response.status_code in (403, 405), f"{method} {path} -> {response.status_code}"

    assert Destination.objects.filter(pk=destination.pk).exists()


# --- profiles ------------------------------------------------------------


@pytest.mark.django_db
def test_profile_me_returns_only_your_own_profile(owner_and_outsider):
    (_, owner), (_, outsider) = owner_and_outsider

    mine = client_for(outsider).get("/api/profile/me/")
    assert mine.status_code == 200
    assert mine.data["supabase_user_id"] == str(outsider.supabase_user_id)
    assert mine.data["supabase_user_id"] != str(owner.supabase_user_id)


@pytest.mark.django_db
def test_public_traveller_view_never_exposes_coordinates(owner_and_outsider):
    (_, owner), (_, outsider) = owner_and_outsider

    response = client_for(outsider).get(f"/api/travellers/{owner.supabase_user_id}/")
    assert response.status_code == 200
    body = response.content.decode()
    for forbidden in ("area_point", '"lat"', '"lng"', "coordinates", "email"):
        assert forbidden not in body
    assert response.data["area_label"] == "owner city"


@pytest.mark.django_db
def test_you_cannot_see_yourself_in_the_traveller_list(owner_and_outsider):
    _, (_, outsider) = owner_and_outsider

    ids = [r["supabase_user_id"] for r in client_for(outsider).get("/api/travellers/").data["results"]]
    assert str(outsider.supabase_user_id) not in ids


# --- connections and messaging ------------------------------------------


@pytest.mark.django_db
def test_outsider_cannot_act_on_a_connection_between_two_others(secret, owner_and_outsider):
    (owner_user, _), (other_user, _) = owner_and_outsider
    _, mallory = make_traveller("mallory")
    connection = Connection.objects.create(
        requester=owner_user, addressee=other_user, status=Connection.Status.ACCEPTED
    )

    client = client_for(mallory)
    assert client.get(f"/api/connections/{connection.pk}/").status_code == 404
    for action in ("accept", "decline", "block", "unblock"):
        assert client.post(f"/api/connections/{connection.pk}/{action}/").status_code == 404

    connection.refresh_from_db()
    assert connection.status == Connection.Status.ACCEPTED


@pytest.mark.django_db
def test_outsider_cannot_read_or_write_a_conversation(secret, owner_and_outsider):
    (owner_user, _), (other_user, _) = owner_and_outsider
    _, mallory = make_traveller("mallory")
    connection = Connection.objects.create(
        requester=owner_user, addressee=other_user, status=Connection.Status.ACCEPTED
    )

    client = client_for(mallory)
    assert client.get(f"/api/connections/{connection.pk}/messages/").status_code == 403
    assert client.post(
        f"/api/connections/{connection.pk}/messages/", {"body": "hi"}, format="json"
    ).status_code == 403
    assert client.post(f"/api/connections/{connection.pk}/messages/read/").status_code == 403


# --- unauthenticated -----------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize(
    "path",
    [
        "/api/profile/me/",
        "/api/travellers/",
        "/api/destinations/",
        "/api/saved-destinations/",
        "/api/trips/",
        "/api/itinerary-items/",
        "/api/budget-items/",
        "/api/buddies/",
        "/api/connections/",
        "/api/messages/summary/",
    ],
)
def test_every_endpoint_requires_a_token(path):
    """The API is closed by default; only /api/health/ and the docs opt out."""
    assert APIClient().get(path).status_code == 401


@pytest.mark.django_db
def test_health_and_docs_stay_open():
    client = APIClient()
    assert client.get("/api/health/").status_code == 200
    assert client.get("/api/schema/").status_code == 200
