"""Regression tests: input limits, bad ids, the health page and view-only members."""

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.budgets.models import BudgetItem
from apps.trips.models import ItineraryItem, Trip, TripCollaborator

User = get_user_model()


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def owner(db):
    return User.objects.create_user(username="owner")


@pytest.fixture
def trip(owner):
    return Trip.objects.create(owner=owner, title="Hampi")


def member(trip, role):
    user = User.objects.create_user(username=role)
    TripCollaborator.objects.create(trip=trip, user=user, role=role)
    return user


# --- Trip budget ------------------------------------------------------------


def test_negative_trip_budget_is_rejected(owner):
    resp = client_for(owner).post(
        "/api/trips/", {"title": "Goa", "target_amount": "-500"}, format="json"
    )
    assert resp.status_code == 400
    assert "target_amount" in resp.data
    assert not Trip.objects.filter(title="Goa").exists()


def test_negative_trip_budget_is_rejected_on_edit(owner, trip):
    resp = client_for(owner).patch(
        f"/api/trips/{trip.pk}/", {"target_amount": "-1"}, format="json"
    )
    assert resp.status_code == 400


@pytest.mark.parametrize("amount", ["0", "5000", None])
def test_zero_positive_and_empty_budgets_still_work(owner, amount):
    resp = client_for(owner).post(
        "/api/trips/", {"title": "Goa", "target_amount": amount}, format="json"
    )
    assert resp.status_code == 201


# --- Applying an AI draft ---------------------------------------------------


def apply(user, trip, day_index=0, **item):
    body = {
        "days": [{"day_index": day_index, "items": [{"title": "Visit", **item}]}],
        "add_to_budget": True,
    }
    return client_for(user).post(
        f"/api/trips/{trip.pk}/apply-itinerary/", body, format="json"
    )


@pytest.mark.parametrize(
    "kwargs",
    [{"day_index": 400}, {"day_index": 60}, {"est_cost": "50000000"}, {"notes": "x" * 2001}],
)
def test_applied_draft_outside_the_limits_saves_nothing(owner, trip, kwargs):
    assert apply(owner, trip, **kwargs).status_code == 400
    assert not ItineraryItem.objects.exists()
    assert not BudgetItem.objects.exists()


def test_applied_draft_at_the_limits_is_saved(owner, trip):
    resp = apply(owner, trip, day_index=59, est_cost="1000000", notes="x" * 2000)
    assert resp.status_code == 201


def test_a_long_dated_trip_can_use_all_its_days(owner):
    long_trip = Trip.objects.create(
        owner=owner, title="Long", start_date="2027-01-01", end_date="2027-04-01"
    )
    assert apply(owner, long_trip, day_index=90).status_code == 201
    assert apply(owner, long_trip, day_index=91).status_code == 400


# --- Ids ----------------------------------------------------------------------


@pytest.mark.parametrize("bad", ["abc", "-1", "0", "1.5", "²", "9" * 30])
@pytest.mark.parametrize(
    "url",
    [
        "/api/trips/open/?destination={}",
        "/api/itinerary-items/?trip={}",
        "/api/budget-items/?trip={}",
        "/api/destination-reviews/?destination={}",
    ],
)
def test_a_bad_id_in_the_query_is_a_400(owner, url, bad):
    assert client_for(owner).get(url.format(bad)).status_code == 400


@pytest.mark.parametrize("body", [{"trip": "abc"}, {"trip": [1]}, {"trip": "9" * 30}, [1, 2]])
def test_a_bad_join_request_is_a_400(owner, body):
    resp = client_for(owner).post("/api/trip-join-requests/", body, format="json")
    assert resp.status_code == 400


# --- View-only members --------------------------------------------------------


@pytest.fixture
def board(owner, trip):
    item = ItineraryItem.objects.create(trip=trip, title="Temple")
    cost = BudgetItem.objects.create(trip=trip, category="Food", label="Lunch", amount=200)
    return item, cost


@pytest.mark.parametrize("url", [
    "/api/trips/{trip}/",
    "/api/trips/{trip}/budget-summary/",
    "/api/itinerary-items/?trip={trip}",
    "/api/budget-items/?trip={trip}",
])
def test_a_viewer_can_read(trip, board, url):
    viewer = member(trip, "viewer")
    assert client_for(viewer).get(url.format(trip=trip.pk)).status_code == 200


@pytest.mark.parametrize("method,url,body", [
    ("patch", "/api/trips/{trip}/", {"title": "Changed"}),
    ("post", "/api/itinerary-items/", {"trip": "{trip}", "title": "New"}),
    ("patch", "/api/itinerary-items/{item}/", {"title": "Changed"}),
    ("delete", "/api/itinerary-items/{item}/", None),
    ("post", "/api/budget-items/", {"trip": "{trip}", "category": "Food", "label": "Tea", "amount": "20"}),
    ("patch", "/api/budget-items/{cost}/", {"amount": "1"}),
    ("delete", "/api/budget-items/{cost}/", None),
    ("post", "/api/trips/{trip}/reorder/", {"items": []}),
    ("post", "/api/trips/{trip}/apply-itinerary/", {"days": []}),
    ("post", "/api/trips/{trip}/generate-itinerary/", {}),
    ("post", "/api/trips/{trip}/ask/", {"question": "Hi"}),
])
def test_a_viewer_cannot_change_anything(trip, board, method, url, body):
    item, cost = board
    viewer = member(trip, "viewer")
    ids = {"trip": trip.pk, "item": item.pk, "cost": cost.pk}
    if body and body.get("trip") == "{trip}":
        body = {**body, "trip": trip.pk}

    resp = getattr(client_for(viewer), method)(url.format(**ids), body, format="json")

    assert resp.status_code == 403
    trip.refresh_from_db()
    assert trip.title == "Hampi"
    assert list(ItineraryItem.objects.values_list("title", flat=True)) == ["Temple"]
    assert list(BudgetItem.objects.values_list("label", "amount")) == [("Lunch", 200)]


def test_an_editor_can_still_change_things(trip):
    editor = member(trip, "editor")
    resp = client_for(editor).post(
        "/api/itinerary-items/", {"trip": trip.pk, "title": "New"}, format="json"
    )
    assert resp.status_code == 201


def test_a_viewer_can_be_recorded_as_payer(owner, trip):
    viewer = member(trip, "viewer")
    resp = client_for(owner).post(
        "/api/budget-items/",
        {"trip": trip.pk, "category": "Food", "label": "Tea", "amount": "20", "payer": viewer.pk},
        format="json",
    )
    assert resp.status_code == 201


# --- Health page --------------------------------------------------------------


def test_health_hides_the_key_and_ignores_a_strangers_probe(db, settings):
    from unittest import mock

    settings.DEBUG = False
    settings.GROQ_API_KEY = "secret-key"
    with mock.patch("config.views._probe_llm") as probe:
        resp = APIClient().get("/api/health/?llm=1", secure=True)
    assert resp.status_code == 200
    assert set(resp.data) == {"ok", "db", "llm_configured"}
    probe.assert_not_called()


def test_staff_can_still_run_the_probe(db, settings):
    from unittest import mock

    settings.DEBUG = False
    settings.GROQ_API_KEY = "secret-key"
    staff = User.objects.create_user(username="staff", is_staff=True)
    with mock.patch("config.views._probe_llm", return_value={"status": 200}) as probe:
        resp = client_for(staff).get("/api/health/?llm=1", secure=True)
    assert resp.data["llm_probe"] == {"status": 200}
    probe.assert_called_once()
