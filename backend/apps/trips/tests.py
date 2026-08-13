import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import jwt
import pytest
from rest_framework.test import APIClient

from apps.accounts.authentication import SUPABASE_AUDIENCE
from apps.accounts.models import Profile
from apps.connections.models import Connection
from apps.trips.models import ItineraryItem, Trip, TripCollaborator

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


def authed_client(sub, email):
    """A client whose token creates (on first call) a real User + Profile."""
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {make_token(sub=sub, email=email)}")
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


# --- Phase 5: itinerary items -----------------------------------------------


@pytest.mark.django_db
def test_itinerary_item_crud_scoped_to_members(client):
    trip_id = client.post("/api/trips/", {"title": "Kerala"}, format="json").data["id"]

    created = client.post(
        "/api/itinerary-items/",
        {"trip": trip_id, "day_index": 0, "position": 0, "title": "Fort Kochi"},
        format="json",
    )
    assert created.status_code == 201
    item_id = created.data["id"]

    listed = client.get(f"/api/itinerary-items/?trip={trip_id}")
    assert [i["title"] for i in listed.data["results"]] == ["Fort Kochi"]

    patched = client.patch(
        f"/api/itinerary-items/{item_id}/", {"title": "Munnar"}, format="json"
    )
    assert patched.status_code == 200
    assert patched.data["title"] == "Munnar"

    assert client.delete(f"/api/itinerary-items/{item_id}/").status_code == 204


@pytest.mark.django_db
def test_non_member_cannot_add_itinerary_item(settings_secret):
    owner = authed_client(str(uuid.uuid4()), "owner@example.com")
    trip_id = owner.post("/api/trips/", {"title": "Private"}, format="json").data["id"]

    stranger = authed_client(str(uuid.uuid4()), "stranger@example.com")
    resp = stranger.post(
        "/api/itinerary-items/",
        {"trip": trip_id, "title": "Sneaky"},
        format="json",
    )
    assert resp.status_code == 400  # serializer rejects: not a member of this trip
    assert not ItineraryItem.objects.filter(title="Sneaky").exists()


# --- Phase 5: reorder -------------------------------------------------------


@pytest.mark.django_db
def test_reorder_persists_day_and_position(client):
    trip_id = client.post("/api/trips/", {"title": "Reorder"}, format="json").data["id"]
    a = client.post(
        "/api/itinerary-items/",
        {"trip": trip_id, "day_index": 0, "position": 0, "title": "A"},
        format="json",
    ).data["id"]
    b = client.post(
        "/api/itinerary-items/",
        {"trip": trip_id, "day_index": 0, "position": 1, "title": "B"},
        format="json",
    ).data["id"]

    # Move B to day 1, and A after it on day 0.
    resp = client.post(
        f"/api/trips/{trip_id}/reorder/",
        {"items": [{"id": b, "day_index": 1, "position": 0},
                   {"id": a, "day_index": 0, "position": 5}]},
        format="json",
    )
    assert resp.status_code == 200

    assert ItineraryItem.objects.get(pk=b).day_index == 1
    assert ItineraryItem.objects.get(pk=a).position == 5


@pytest.mark.django_db
def test_reorder_rejects_foreign_item(client):
    mine = client.post("/api/trips/", {"title": "Mine"}, format="json").data["id"]
    other = authed_client(str(uuid.uuid4()), "other@example.com")
    their_trip = other.post("/api/trips/", {"title": "Theirs"}, format="json").data["id"]
    their_item = other.post(
        "/api/itinerary-items/",
        {"trip": their_trip, "title": "Not yours"},
        format="json",
    ).data["id"]

    resp = client.post(
        f"/api/trips/{mine}/reorder/",
        {"items": [{"id": their_item, "day_index": 0, "position": 0}]},
        format="json",
    )
    assert resp.status_code == 400


# --- Phase 5: invite collaborators ------------------------------------------


def _connect(user_a_sub, user_b_sub):
    """Make an ACCEPTED connection between two already-created users."""
    a = Profile.objects.get(supabase_user_id=user_a_sub).user
    b = Profile.objects.get(supabase_user_id=user_b_sub).user
    Connection.objects.create(
        requester=a, addressee=b, status=Connection.Status.ACCEPTED
    )


@pytest.mark.django_db
def test_invite_accepted_connection_grants_access(settings_secret):
    owner_sub, friend_sub = str(uuid.uuid4()), str(uuid.uuid4())
    owner = authed_client(owner_sub, "owner@example.com")
    friend = authed_client(friend_sub, "friend@example.com")

    trip_id = owner.post("/api/trips/", {"title": "Shared"}, format="json").data["id"]
    # Friend cannot see it yet.
    assert friend.get(f"/api/trips/{trip_id}/").status_code == 404

    _connect(owner_sub, friend_sub)
    resp = owner.post(
        f"/api/trips/{trip_id}/invite/",
        {"supabase_user_id": friend_sub},
        format="json",
    )
    assert resp.status_code == 201
    assert TripCollaborator.objects.filter(trip_id=trip_id).count() == 1
    # Now the friend can read and edit it.
    assert friend.get(f"/api/trips/{trip_id}/").status_code == 200
    assert friend.post(
        "/api/itinerary-items/",
        {"trip": trip_id, "title": "Friend's plan"},
        format="json",
    ).status_code == 201


@pytest.mark.django_db
def test_invite_rejects_non_connection(settings_secret):
    owner_sub, stranger_sub = str(uuid.uuid4()), str(uuid.uuid4())
    owner = authed_client(owner_sub, "owner@example.com")
    stranger = authed_client(stranger_sub, "stranger@example.com")
    stranger.get("/api/trips/")  # force the stranger's Profile to exist

    trip_id = owner.post("/api/trips/", {"title": "Shared"}, format="json").data["id"]
    resp = owner.post(
        f"/api/trips/{trip_id}/invite/",
        {"supabase_user_id": stranger_sub},
        format="json",
    )
    assert resp.status_code == 400
    assert not TripCollaborator.objects.exists()


@pytest.mark.django_db
def test_only_owner_can_invite(settings_secret):
    owner_sub, friend_sub, third_sub = (str(uuid.uuid4()) for _ in range(3))
    owner = authed_client(owner_sub, "owner@example.com")
    friend = authed_client(friend_sub, "friend@example.com")
    friend.get("/api/trips/")  # create the friend's Profile
    authed_client(third_sub, "third@example.com").get("/api/trips/")

    trip_id = owner.post("/api/trips/", {"title": "Shared"}, format="json").data["id"]
    _connect(owner_sub, friend_sub)
    owner.post(
        f"/api/trips/{trip_id}/invite/", {"supabase_user_id": friend_sub}, format="json"
    )
    # A collaborator (not the owner) may not invite a third traveller.
    _connect(friend_sub, third_sub)
    resp = friend.post(
        f"/api/trips/{trip_id}/invite/", {"supabase_user_id": third_sub}, format="json"
    )
    assert resp.status_code == 403


# --- Phase 5: public sharing ------------------------------------------------


@pytest.mark.django_db
def test_share_link_public_then_revoked(client):
    trip_id = client.post("/api/trips/", {"title": "Show-off"}, format="json").data["id"]
    client.post(
        "/api/itinerary-items/",
        {"trip": trip_id, "day_index": 0, "position": 0, "title": "Beach"},
        format="json",
    )
    token = Trip.objects.get(pk=trip_id).share_token

    anon = APIClient()  # no Authorization header
    # Not public yet -> 404.
    assert anon.get(f"/api/share/{token}/").status_code == 404

    assert client.post(f"/api/trips/{trip_id}/share/").status_code == 200
    shared = anon.get(f"/api/share/{token}/")
    assert shared.status_code == 200
    assert shared.data["title"] == "Show-off"
    assert [i["title"] for i in shared.data["itinerary_items"]] == ["Beach"]

    # Revoke -> link 404s again.
    assert client.post(f"/api/trips/{trip_id}/unshare/").status_code == 200
    assert anon.get(f"/api/share/{token}/").status_code == 404


@pytest.mark.django_db
def test_only_owner_can_share(settings_secret):
    owner_sub, friend_sub = str(uuid.uuid4()), str(uuid.uuid4())
    owner = authed_client(owner_sub, "owner@example.com")
    friend = authed_client(friend_sub, "friend@example.com")
    friend.get("/api/trips/")  # create the friend's Profile
    trip_id = owner.post("/api/trips/", {"title": "Shared"}, format="json").data["id"]
    _connect(owner_sub, friend_sub)
    owner.post(
        f"/api/trips/{trip_id}/invite/", {"supabase_user_id": friend_sub}, format="json"
    )

    # Collaborator can read the trip but cannot publish it.
    assert friend.post(f"/api/trips/{trip_id}/share/").status_code == 403
    assert Trip.objects.get(pk=trip_id).is_public is False


# --- Phase 6: AI itinerary generation ---------------------------------------
# call_llm is monkeypatched everywhere below — no test makes a live API call.

RECORDED_PLAN = """
{"days": [
  {"items": [
    {"title": "Train to Goa", "category": "Transport", "est_cost": 800},
    {"title": "Hostel", "category": "Stay", "est_cost": 600}
  ]},
  {"items": [
    {"title": "Beach lunch", "category": "Food", "est_cost": 400}
  ]}
]}
"""


@pytest.mark.django_db
def test_generate_itinerary_returns_validated_draft(client, monkeypatch):
    monkeypatch.setattr("apps.trips.ai_service.call_llm", lambda prompt: RECORDED_PLAN)
    trip_id = client.post(
        "/api/trips/", {"title": "Goa", "target_amount": "5000"}, format="json"
    ).data["id"]

    resp = client.post(
        f"/api/trips/{trip_id}/generate-itinerary/",
        {"style": "relaxed", "transport_pref": "train"},
        format="json",
    )
    assert resp.status_code == 200
    assert resp.data["total"] == "1800"
    assert resp.data["over_budget"] is False
    assert len(resp.data["days"]) == 2
    # Nothing was persisted — it's only a draft.
    assert not ItineraryItem.objects.filter(trip_id=trip_id).exists()


@pytest.mark.django_db
def test_generate_itinerary_flags_over_budget(client, monkeypatch):
    monkeypatch.setattr("apps.trips.ai_service.call_llm", lambda prompt: RECORDED_PLAN)
    trip_id = client.post(
        "/api/trips/", {"title": "Goa", "target_amount": "500"}, format="json"
    ).data["id"]

    resp = client.post(f"/api/trips/{trip_id}/generate-itinerary/", {}, format="json")
    assert resp.status_code == 200
    assert resp.data["over_budget"] is True
    assert len(resp.data["offending_items"]) >= 1


@pytest.mark.django_db
def test_generate_itinerary_503_when_unconfigured(client, settings):
    # No monkeypatch: an empty key makes call_llm raise LLMConfigError, still
    # with no network touched.
    settings.GROK_API_KEY = ""
    trip_id = client.post("/api/trips/", {"title": "Goa"}, format="json").data["id"]
    resp = client.post(f"/api/trips/{trip_id}/generate-itinerary/", {}, format="json")
    assert resp.status_code == 503


@pytest.mark.django_db
def test_generate_itinerary_requires_membership(settings_secret, monkeypatch):
    monkeypatch.setattr("apps.trips.ai_service.call_llm", lambda prompt: RECORDED_PLAN)
    other = authed_client(str(uuid.uuid4()), "other@example.com")
    trip_id = other.post("/api/trips/", {"title": "Theirs"}, format="json").data["id"]

    stranger = authed_client(str(uuid.uuid4()), "stranger@example.com")
    resp = stranger.post(f"/api/trips/{trip_id}/generate-itinerary/", {}, format="json")
    assert resp.status_code == 404  # scoped out of the queryset


@pytest.mark.django_db
def test_apply_itinerary_persists_items(client):
    trip_id = client.post("/api/trips/", {"title": "Goa"}, format="json").data["id"]
    # A pre-existing item so we prove the draft appends, not overwrites.
    client.post(
        "/api/itinerary-items/",
        {"trip": trip_id, "day_index": 0, "position": 0, "title": "Existing"},
        format="json",
    )

    payload = {
        "add_to_budget": True,
        "days": [
            {
                "day_index": 0,
                "items": [
                    {"title": "Train to Goa", "category": "Transport", "est_cost": "800"}
                ],
            },
            {
                "day_index": 1,
                "items": [
                    {"title": "Beach lunch", "category": "Food", "est_cost": "400"}
                ],
            },
        ],
    }
    resp = client.post(
        f"/api/trips/{trip_id}/apply-itinerary/", payload, format="json"
    )
    assert resp.status_code == 201
    assert ItineraryItem.objects.filter(trip_id=trip_id).count() == 3  # 1 + 2
    # Appended after the existing day-0 item.
    appended = ItineraryItem.objects.get(trip_id=trip_id, title="Train to Goa")
    assert (appended.day_index, appended.position) == (0, 1)
    # add_to_budget mirrored the costs into the Budget Planner.
    from apps.budgets.models import BudgetItem

    assert BudgetItem.objects.filter(trip_id=trip_id).count() == 2


@pytest.mark.django_db
def test_apply_itinerary_denied_to_non_member(settings_secret):
    owner = authed_client(str(uuid.uuid4()), "owner@example.com")
    trip_id = owner.post("/api/trips/", {"title": "Theirs"}, format="json").data["id"]
    stranger = authed_client(str(uuid.uuid4()), "stranger@example.com")

    resp = stranger.post(
        f"/api/trips/{trip_id}/apply-itinerary/",
        {"days": [{"day_index": 0, "items": [{"title": "X", "category": "Food"}]}]},
        format="json",
    )
    assert resp.status_code == 404
    assert not ItineraryItem.objects.filter(title="X").exists()
