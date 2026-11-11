import json
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
def test_budget_summary_includes_member_names(client):
    trip_id = client.post("/api/trips/", {"title": "Goa run"}, format="json").data["id"]
    resp = client.get(f"/api/trips/{trip_id}/budget-summary/")
    assert resp.status_code == 200

    trip = Trip.objects.get(pk=trip_id)
    members = resp.data["members"]
    assert str(trip.owner_id) in members
    assert members[str(trip.owner_id)]["display_name"]
    assert members[str(trip.owner_id)]["is_owner"] is True


@pytest.mark.django_db
def test_budget_summary_includes_settlements_and_is_me(client):
    trip_id = client.post("/api/trips/", {"title": "Goa run"}, format="json").data["id"]
    trip = Trip.objects.get(pk=trip_id)

    other = APIClient()
    other.credentials(HTTP_AUTHORIZATION=f"Bearer {make_token(email='other@example.com')}")
    other_id = other.get("/api/profile/me/").data["supabase_user_id"]
    other_user = Profile.objects.get(supabase_user_id=other_id).user
    TripCollaborator.objects.create(trip=trip, user=other_user)

    client.post(
        "/api/budget-items/",
        {"trip": trip_id, "category": "Stay", "label": "Hotel", "amount": "1000", "payer": trip.owner_id},
        format="json",
    )

    resp = client.get(f"/api/trips/{trip_id}/budget-summary/")
    assert resp.status_code == 200
    settlements = resp.data["settlements"]
    assert len(settlements) == 1
    assert settlements[0]["amount"] == Decimal("500.00")
    assert settlements[0]["to_user"] == trip.owner_id

    members = resp.data["members"]
    assert members[str(trip.owner_id)]["is_me"] is True
    assert members[str(other_user.pk)]["is_me"] is False
    assert "upi_vpa" in members[str(trip.owner_id)]


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
def test_is_owner_flag_reflects_requesting_user(settings_secret):
    owner_sub, friend_sub = str(uuid.uuid4()), str(uuid.uuid4())
    owner = authed_client(owner_sub, "owner@example.com")
    friend = authed_client(friend_sub, "friend@example.com")
    friend.get("/api/trips/")  # create the friend's Profile
    trip_id = owner.post("/api/trips/", {"title": "Shared"}, format="json").data["id"]
    _connect(owner_sub, friend_sub)
    owner.post(
        f"/api/trips/{trip_id}/invite/", {"supabase_user_id": friend_sub}, format="json"
    )

    assert owner.get(f"/api/trips/{trip_id}/").data["is_owner"] is True
    assert friend.get(f"/api/trips/{trip_id}/").data["is_owner"] is False


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


# --- P4: open to join / join requests / cover photo -------------------------


@pytest.mark.django_db
def test_cover_image_url_is_plain_patch_writable(client):
    trip_id = client.post("/api/trips/", {"title": "Goa run"}, format="json").data["id"]
    resp = client.patch(
        f"/api/trips/{trip_id}/", {"cover_image_url": "https://example.com/c.jpg"}, format="json"
    )
    assert resp.status_code == 200
    assert resp.data["cover_image_url"] == "https://example.com/c.jpg"


@pytest.mark.django_db
def test_is_open_to_join_ignored_on_plain_patch(client):
    # Same public-exposure risk as is_public: not settable via a plain PATCH,
    # only through the dedicated owner-gated actions below.
    trip_id = client.post("/api/trips/", {"title": "Goa run"}, format="json").data["id"]
    resp = client.patch(f"/api/trips/{trip_id}/", {"is_open_to_join": True}, format="json")
    assert resp.status_code == 200
    assert Trip.objects.get(pk=trip_id).is_open_to_join is False


@pytest.mark.django_db
def test_only_owner_can_open_trip_to_join(settings_secret):
    owner_sub, friend_sub = str(uuid.uuid4()), str(uuid.uuid4())
    owner = authed_client(owner_sub, "owner@example.com")
    friend = authed_client(friend_sub, "friend@example.com")
    friend.get("/api/trips/")
    trip_id = owner.post("/api/trips/", {"title": "Shared"}, format="json").data["id"]
    _connect(owner_sub, friend_sub)
    owner.post(f"/api/trips/{trip_id}/invite/", {"supabase_user_id": friend_sub}, format="json")

    assert friend.post(f"/api/trips/{trip_id}/open-to-join/").status_code == 403

    resp = owner.post(f"/api/trips/{trip_id}/open-to-join/")
    assert resp.status_code == 200
    assert resp.data["is_open_to_join"] is True


@pytest.mark.django_db
def test_open_trips_lists_only_opted_in_trips_for_a_destination(settings_secret):
    from apps.destinations.models import Destination
    from django.contrib.gis.geos import Point

    dest = Destination.objects.create(
        name="Goa", slug="goa-open-trips", point=Point(74.1, 15.3, srid=4326),
        avg_daily_budget=1500, budget_tier="budget",
    )
    owner = authed_client(str(uuid.uuid4()), "owner@example.com")
    open_trip = owner.post(
        "/api/trips/", {"title": "Open one", "destination": dest.id}, format="json"
    ).data["id"]
    owner.post(f"/api/trips/{open_trip}/open-to-join/")
    owner.post("/api/trips/", {"title": "Closed one", "destination": dest.id}, format="json")

    stranger = authed_client(str(uuid.uuid4()), "stranger@example.com")
    resp = stranger.get(f"/api/trips/open/?destination={dest.id}")
    assert resp.status_code == 200
    assert [t["title"] for t in resp.data] == ["Open one"]
    # Narrow shape: no budget/share fields leaked to a non-member.
    assert set(resp.data[0]) == {
        "id", "title", "start_date", "end_date", "nights",
        "owner_name", "owner_avatar_url", "collaborator_count",
    }


@pytest.mark.django_db
def test_join_request_accept_adds_collaborator(settings_secret):
    owner = authed_client(str(uuid.uuid4()), "owner@example.com")
    trip_id = owner.post("/api/trips/", {"title": "Open trip"}, format="json").data["id"]
    owner.post(f"/api/trips/{trip_id}/open-to-join/")

    stranger_sub = str(uuid.uuid4())
    stranger = authed_client(stranger_sub, "stranger@example.com")
    created = stranger.post(
        "/api/trip-join-requests/", {"trip": trip_id, "message": "Can I come?"}, format="json"
    )
    assert created.status_code == 201
    request_id = created.data["id"]

    # Only the owner may accept.
    assert stranger.post(f"/api/trip-join-requests/{request_id}/accept/").status_code == 403

    resp = owner.post(f"/api/trip-join-requests/{request_id}/accept/")
    assert resp.status_code == 200
    assert resp.data["status"] == "accepted"

    stranger_user = Profile.objects.get(supabase_user_id=stranger_sub).user
    assert TripCollaborator.objects.filter(trip_id=trip_id, user=stranger_user).exists()

    # Now a member — the itinerary board works for them.
    assert stranger.get(f"/api/trips/{trip_id}/").status_code == 200


@pytest.mark.django_db
def test_join_request_decline_does_not_add_collaborator(settings_secret):
    owner = authed_client(str(uuid.uuid4()), "owner@example.com")
    trip_id = owner.post("/api/trips/", {"title": "Open trip"}, format="json").data["id"]
    owner.post(f"/api/trips/{trip_id}/open-to-join/")

    stranger = authed_client(str(uuid.uuid4()), "stranger@example.com")
    request_id = stranger.post(
        "/api/trip-join-requests/", {"trip": trip_id}, format="json"
    ).data["id"]

    resp = owner.post(f"/api/trip-join-requests/{request_id}/decline/")
    assert resp.status_code == 200
    assert resp.data["status"] == "declined"
    assert TripCollaborator.objects.filter(trip_id=trip_id).count() == 0
    assert stranger.get(f"/api/trips/{trip_id}/").status_code == 404


@pytest.mark.django_db
def test_cannot_request_to_join_a_closed_trip(settings_secret):
    owner = authed_client(str(uuid.uuid4()), "owner@example.com")
    trip_id = owner.post("/api/trips/", {"title": "Closed trip"}, format="json").data["id"]

    stranger = authed_client(str(uuid.uuid4()), "stranger@example.com")
    resp = stranger.post("/api/trip-join-requests/", {"trip": trip_id}, format="json")
    assert resp.status_code == 400


@pytest.mark.django_db
def test_duplicate_join_request_is_409(settings_secret):
    owner = authed_client(str(uuid.uuid4()), "owner@example.com")
    trip_id = owner.post("/api/trips/", {"title": "Open trip"}, format="json").data["id"]
    owner.post(f"/api/trips/{trip_id}/open-to-join/")

    stranger = authed_client(str(uuid.uuid4()), "stranger@example.com")
    stranger.post("/api/trip-join-requests/", {"trip": trip_id}, format="json")
    second = stranger.post("/api/trip-join-requests/", {"trip": trip_id}, format="json")
    assert second.status_code == 409


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
    settings.GROQ_API_KEY = ""
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


ASSISTANT_REPLY = (
    '{"answer": "Hampi is cheap: ~900/day.", "plan": {"days": [{"items": ['
    '{"title": "Stay", "category": "Stay", "est_cost": 3000}, '
    '{"title": "Food", "category": "Food", "est_cost": 3000}]}]}}'
)


@pytest.mark.django_db
def test_ask_assistant_budget_checks_plan(client, monkeypatch):
    monkeypatch.setattr("apps.trips.ai_service.call_llm", lambda prompt: ASSISTANT_REPLY)
    trip_id = client.post(
        "/api/trips/", {"title": "Hampi", "target_amount": "5000"}, format="json"
    ).data["id"]
    resp = client.post(f"/api/trips/{trip_id}/ask/", {"question": "3 days?"}, format="json")
    assert resp.status_code == 200
    assert resp.data["answer"].startswith("Hampi")
    assert resp.data["plan"]["over_budget"] is True  # 6000 > 5000, flagged not hidden


@pytest.mark.django_db
def test_ask_assistant_503_when_unconfigured(client, settings):
    settings.GROQ_API_KEY = ""
    trip_id = client.post("/api/trips/", {"title": "Goa"}, format="json").data["id"]
    resp = client.post(f"/api/trips/{trip_id}/ask/", {"question": "hi"}, format="json")
    assert resp.status_code == 503


# --- Trip assistant chat (Phase A) -----------------------------------------

CHAT_REPLY = json.dumps(
    {
        "title": "Budget Hampi weekend",
        "answer": "**Hampi** works on that budget.",
        "context": {"destination": "Hampi", "days": 3, "travellers": 2, "budget": 5000},
        "places": ["hampi", "not-a-real-slug", "hampi"],
        "plan": {"days": [{"items": [
            {"title": "Hostel", "category": "Stay", "est_cost": 4000},
            {"title": "Food", "category": "Food", "est_cost": 2000},
        ]}]},
        "follow_up": "Where are you starting from?",
    }
)


@pytest.fixture
def hampi(db):
    from django.contrib.gis.geos import Point

    from apps.destinations.models import Destination

    return Destination.objects.create(
        name="Hampi", slug="hampi", point=Point(76.46, 15.335, srid=4326),
        avg_daily_budget=900, budget_tier="budget", state="Karnataka",
    )


@pytest.mark.django_db
def test_chat_create_saves_turn_and_validates_reply(client, hampi, monkeypatch):
    monkeypatch.setattr("apps.trips.ai_service.call_llm", lambda messages: CHAT_REPLY)
    resp = client.post("/api/chats/", {"message": "3 days in Hampi for 5000?"}, format="json")

    assert resp.status_code == 201
    assert resp.data["title"] == "Budget Hampi weekend"
    assert resp.data["context"] == {"destination": "Hampi", "days": 3, "travellers": 2, "budget": 5000}
    user_msg, bot_msg = resp.data["messages"]
    assert user_msg["role"] == "user" and bot_msg["role"] == "assistant"
    # Unknown and duplicate slugs are dropped; known ones carry map data.
    assert [p["slug"] for p in bot_msg["data"]["places"]] == ["hampi"]
    assert bot_msg["data"]["places"][0]["lat"] == pytest.approx(15.335)
    # 6000 against the chat's own 5000 budget: flagged, not hidden.
    assert bot_msg["data"]["plan"]["over_budget"] is True
    assert bot_msg["data"]["follow_up"] == "Where are you starting from?"


@pytest.mark.django_db
def test_chat_follow_up_sends_history(client, hampi, monkeypatch):
    seen = []

    def fake(messages):
        seen.append(messages)
        return CHAT_REPLY

    monkeypatch.setattr("apps.trips.ai_service.call_llm", fake)
    chat_id = client.post("/api/chats/", {"message": "first"}, format="json").data["id"]
    resp = client.post(f"/api/chats/{chat_id}/messages/", {"message": "cheaper?"}, format="json")

    assert resp.status_code == 200
    assert len(resp.data["messages"]) == 4
    roles = [m["role"] for m in seen[1]]
    assert roles == ["system", "user", "assistant", "user"]
    assert seen[1][-1]["content"] == "cheaper?"


@pytest.mark.django_db
def test_chat_provider_failure_saves_nothing(client, monkeypatch):
    from apps.trips import ai_service
    from apps.trips.models import Conversation

    def boom(messages):
        raise ai_service.LLMError("down")

    monkeypatch.setattr("apps.trips.ai_service.call_llm", boom)
    resp = client.post("/api/chats/", {"message": "hi"}, format="json")
    assert resp.status_code == 502
    assert not Conversation.objects.exists()


@pytest.mark.django_db
def test_chat_503_when_unconfigured(client, settings):
    settings.GROQ_API_KEY = ""
    assert client.post("/api/chats/", {"message": "hi"}, format="json").status_code == 503


@pytest.mark.django_db
def test_chats_are_private_and_trip_link_checked(client, settings_secret, monkeypatch):
    monkeypatch.setattr("apps.trips.ai_service.call_llm", lambda messages: CHAT_REPLY)
    chat_id = client.post("/api/chats/", {"message": "hi"}, format="json").data["id"]

    stranger = authed_client(str(uuid.uuid4()), "stranger@example.com")
    assert stranger.get(f"/api/chats/{chat_id}/").status_code == 404
    assert stranger.get("/api/chats/").data["results"] == []

    their_trip = stranger.post("/api/trips/", {"title": "Theirs"}, format="json").data["id"]
    resp = client.patch(f"/api/chats/{chat_id}/", {"trip": their_trip}, format="json")
    assert resp.status_code == 400

    my_trip = client.post("/api/trips/", {"title": "Mine"}, format="json").data["id"]
    resp = client.patch(f"/api/chats/{chat_id}/", {"trip": my_trip, "title": "Renamed"}, format="json")
    assert resp.status_code == 200
    assert resp.data["trip_title"] == "Mine" and resp.data["title"] == "Renamed"


def test_parse_chat_reply_drops_bad_context():
    from apps.trips.llm import parse_chat_reply

    reply = parse_chat_reply(
        '{"answer": "ok", "context": {"days": "lots", "travellers": 500, "budget": "4000"}}'
    )
    assert reply["context"] == {"budget": 4000}
    assert reply["places"] == [] and reply["days"] is None and reply["follow_up"] is None


def test_parse_chat_reply_unwraps_list():
    from apps.trips.llm import parse_chat_reply

    assert parse_chat_reply('[{"answer": "hi"}]')["answer"] == "hi"


@pytest.mark.django_db
def test_catalogue_data_details_what_the_chat_is_about():
    from django.contrib.gis.geos import Point

    from apps.destinations.models import Destination
    from apps.trips.ai_service import CATALOGUE_DETAIL_LIMIT, _catalogue_data

    for i in range(CATALOGUE_DETAIL_LIMIT + 5):
        Destination.objects.create(
            name=f"Place {i}", slug=f"place-{i}", point=Point(77, 12, srid=4326),
            avg_daily_budget=1000 + i, budget_tier="budget", state="Karnataka",
        )
    Destination.objects.create(
        name="Ziro", slug="ziro", point=Point(93.8, 27.5, srid=4326),
        avg_daily_budget=9999, budget_tier="comfort", state="Arunachal Pradesh",
    )
    data = _catalogue_data(list(Destination.objects.all()), "thinking about ziro in march")

    detail = data["destinations"][1:]
    assert len(detail) == CATALOGUE_DETAIL_LIMIT
    assert detail[0].startswith("ziro|")  # named place first, despite its price
    assert "ziro" not in data["other_destinations"]
    assert "place-16 (Karnataka)" in data["other_destinations"]  # priciest padding left out
