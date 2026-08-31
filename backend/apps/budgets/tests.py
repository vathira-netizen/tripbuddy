"""Tests for apps.budgets: pure services.py math, then the CRUD API on top.

BudgetItem-like inputs to services.py are plain SimpleNamespace objects:
services.py only reads .category/.amount/.payer_id, so there's no need to
touch the ORM (or mark those tests @pytest.mark.django_db) to exercise the
math. The API tests below need the database, same auth-fixture pattern as
apps.trips.tests / apps.destinations.tests.
"""

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

import jwt
import pytest
from rest_framework.test import APIClient

from apps.accounts.authentication import SUPABASE_AUDIENCE
from apps.budgets import services
from apps.budgets.models import BudgetItem

SECRET = "test-jwt-secret"


def item(category, amount, payer_id=None):
    return SimpleNamespace(category=category, amount=Decimal(str(amount)), payer_id=payer_id)


# --- category_totals ---------------------------------------------------------


def test_category_totals_zero_fills_every_category():
    totals = services.category_totals([item("Food", "100")])

    assert set(totals) == set(BudgetItem.Category.values)
    assert totals["Food"] == Decimal("100.00")
    assert totals["Stay"] == Decimal("0.00")


def test_category_totals_sums_repeated_categories():
    items = [item("Food", "100"), item("Food", "50.50"), item("Transport", "20")]
    totals = services.category_totals(items)

    assert totals["Food"] == Decimal("150.50")
    assert totals["Transport"] == Decimal("20.00")


def test_category_totals_empty_is_all_zero():
    totals = services.category_totals([])
    assert all(v == Decimal("0.00") for v in totals.values())


# --- per_day_breakdown --------------------------------------------------------


def test_per_day_breakdown_divides_by_nights():
    items = [item("Food", "100"), item("Stay", "300")]
    result = services.per_day_breakdown(items, nights=4)

    assert result["total_per_day"] == Decimal("100.00")
    assert result["category_per_day"]["Food"] == Decimal("25.00")
    assert result["category_per_day"]["Stay"] == Decimal("75.00")
    assert result["category_per_day"]["Transport"] == Decimal("0.00")


def test_per_day_breakdown_zero_nights_is_zero_not_an_error():
    items = [item("Food", "100")]
    result = services.per_day_breakdown(items, nights=0)

    assert result["total_per_day"] == Decimal("0.00")
    assert all(v == Decimal("0.00") for v in result["category_per_day"].values())


# --- per_person_split ---------------------------------------------------------


def test_per_person_split_equal_when_no_payer_set():
    items = [item("Food", "100"), item("Stay", "200")]
    result = services.per_person_split(items, members=[1, 2, 3])

    assert result["total"] == Decimal("300.00")
    assert result["equal_share"] == Decimal("100.00")
    for member in (1, 2, 3):
        assert result["per_member"][member] == {
            "paid": Decimal("0.00"),
            "owed": Decimal("100.00"),
            "balance": Decimal("-100.00"),
        }


def test_per_person_split_paid_vs_owed_with_payers():
    # Alice (1) pays for everything; Bob (2) and Carol (3) owe her.
    items = [item("Food", "90", payer_id=1), item("Stay", "210", payer_id=1)]
    result = services.per_person_split(items, members=[1, 2, 3])

    assert result["equal_share"] == Decimal("100.00")
    assert result["per_member"][1] == {
        "paid": Decimal("300.00"),
        "owed": Decimal("100.00"),
        "balance": Decimal("200.00"),  # is owed 200 back
    }
    assert result["per_member"][2] == {
        "paid": Decimal("0.00"),
        "owed": Decimal("100.00"),
        "balance": Decimal("-100.00"),  # owes 100
    }


def test_per_person_split_ignores_payer_not_in_members():
    # A payment made by someone outside the split (e.g. removed collaborator)
    # still counts toward the total but not toward anyone's "paid".
    items = [item("Food", "90", payer_id=99)]
    result = services.per_person_split(items, members=[1, 2])

    assert result["total"] == Decimal("90.00")
    assert result["per_member"][1]["paid"] == Decimal("0.00")


def test_per_person_split_no_members_is_empty_not_a_crash():
    result = services.per_person_split([item("Food", "10")], members=[])
    assert result["equal_share"] == Decimal("0.00")
    assert result["per_member"] == {}


# --- simplify_debts -----------------------------------------------------------


def test_simplify_debts_one_payer_three_way_split():
    # Alice paid 300 for a 3-way split: Bob and Carol each owe her 100.
    items = [item("Food", "90", payer_id=1), item("Stay", "210", payer_id=1)]
    split = services.per_person_split(items, members=[1, 2, 3])

    settlements = services.simplify_debts(split["per_member"])
    assert {(s["from_user"], s["to_user"], s["amount"]) for s in settlements} == {
        (2, 1, Decimal("100.00")),
        (3, 1, Decimal("100.00")),
    }


def test_simplify_debts_already_settled_is_empty():
    items = [item("Food", "100", payer_id=1), item("Food", "100", payer_id=2)]
    split = services.per_person_split(items, members=[1, 2])
    assert services.simplify_debts(split["per_member"]) == []


def test_simplify_debts_minimises_transaction_count():
    # Four members, one big payer (1) and one who paid nothing extra (4) among
    # otherwise-even payers — optimal settlement is 3 transactions max
    # (n - 1 members), never one per pair.
    items = [
        item("Stay", "400", payer_id=1),
        item("Food", "40", payer_id=2),
        item("Food", "40", payer_id=3),
    ]
    split = services.per_person_split(items, members=[1, 2, 3, 4])
    settlements = services.simplify_debts(split["per_member"])

    assert len(settlements) <= 3
    # Every settlement actually moves money and nobody pays themselves.
    for s in settlements:
        assert s["amount"] > 0
        assert s["from_user"] != s["to_user"]
    # The settlements exactly cancel out each member's balance.
    net = {m: Decimal("0") for m in (1, 2, 3, 4)}
    for s in settlements:
        net[s["from_user"]] -= s["amount"]
        net[s["to_user"]] += s["amount"]
    for member_id, balance in net.items():
        assert balance == split["per_member"][member_id]["balance"]


# --- running_total_vs_target --------------------------------------------------


def test_running_total_vs_target_no_target_set():
    result = services.running_total_vs_target([item("Food", "50")], target=None)
    assert result == {
        "total": Decimal("50.00"),
        "target": None,
        "remaining": None,
        "over_budget": False,
    }


def test_running_total_vs_target_within_budget():
    items = [item("Food", "50"), item("Stay", "150")]
    result = services.running_total_vs_target(items, target=Decimal("300"))

    assert result["total"] == Decimal("200.00")
    assert result["remaining"] == Decimal("100.00")
    assert result["over_budget"] is False


def test_running_total_vs_target_over_budget():
    items = [item("Food", "200"), item("Stay", "150")]
    result = services.running_total_vs_target(items, target=Decimal("300"))

    assert result["total"] == Decimal("350.00")
    assert result["remaining"] == Decimal("-50.00")
    assert result["over_budget"] is True


# --- BudgetItemViewSet (API) --------------------------------------------------


def make_token(email="trav@example.com"):
    now = datetime.now(tz=timezone.utc)
    return jwt.encode(
        {
            "sub": str(uuid.uuid4()),
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
def test_budget_item_crud(client):
    trip_id = client.post("/api/trips/", {"title": "Goa run"}, format="json").data["id"]

    created = client.post(
        "/api/budget-items/",
        {"trip": trip_id, "category": "Transport", "label": "Flight", "amount": "4500"},
        format="json",
    )
    assert created.status_code == 201
    item_id = created.data["id"]

    updated = client.patch(
        f"/api/budget-items/{item_id}/", {"amount": "5000"}, format="json"
    )
    assert updated.status_code == 200
    assert updated.data["amount"] == "5000.00"

    assert client.delete(f"/api/budget-items/{item_id}/").status_code == 204


@pytest.mark.django_db
def test_budget_item_reports_payer_name(client):
    from apps.trips.models import Trip

    trip_id = client.post("/api/trips/", {"title": "Goa run"}, format="json").data["id"]
    me = client.get("/api/profile/me/").data
    owner_id = Trip.objects.get(pk=trip_id).owner_id

    created = client.post(
        "/api/budget-items/",
        {"trip": trip_id, "category": "Food", "label": "Lunch", "amount": "300", "payer": owner_id},
        format="json",
    )
    assert created.status_code == 201
    assert created.data["payer_name"] == me["display_name"]
    assert "payer_avatar_url" in created.data


@pytest.mark.django_db
def test_budget_item_rejects_foreign_trip(client):
    other = APIClient()
    other.credentials(HTTP_AUTHORIZATION=f"Bearer {make_token(email='other@example.com')}")
    foreign_trip_id = other.post(
        "/api/trips/", {"title": "Theirs"}, format="json"
    ).data["id"]

    resp = client.post(
        "/api/budget-items/",
        {"trip": foreign_trip_id, "category": "Food", "label": "Snacks", "amount": "50"},
        format="json",
    )
    assert resp.status_code == 400
    assert "trip" in resp.data


@pytest.mark.django_db
def test_budget_item_list_is_scoped_to_own_trips(client):
    trip_id = client.post("/api/trips/", {"title": "Mine"}, format="json").data["id"]
    client.post(
        "/api/budget-items/",
        {"trip": trip_id, "category": "Food", "label": "Lunch", "amount": "100"},
        format="json",
    )

    other = APIClient()
    other.credentials(HTTP_AUTHORIZATION=f"Bearer {make_token(email='other@example.com')}")
    other_trip_id = other.post("/api/trips/", {"title": "Theirs"}, format="json").data["id"]
    other.post(
        "/api/budget-items/",
        {"trip": other_trip_id, "category": "Food", "label": "Dinner", "amount": "200"},
        format="json",
    )

    labels = [b["label"] for b in client.get("/api/budget-items/").data["results"]]
    assert labels == ["Lunch"]


@pytest.mark.django_db
def test_budget_item_list_can_filter_by_trip(client):
    trip_a = client.post("/api/trips/", {"title": "A"}, format="json").data["id"]
    trip_b = client.post("/api/trips/", {"title": "B"}, format="json").data["id"]
    client.post(
        "/api/budget-items/",
        {"trip": trip_a, "category": "Food", "label": "A-item", "amount": "10"},
        format="json",
    )
    client.post(
        "/api/budget-items/",
        {"trip": trip_b, "category": "Food", "label": "B-item", "amount": "20"},
        format="json",
    )

    labels = [
        b["label"]
        for b in client.get(f"/api/budget-items/?trip={trip_a}").data["results"]
    ]
    assert labels == ["A-item"]
