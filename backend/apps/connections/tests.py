"""Connection requests: send, accept, decline, block.

The block tests are the important ones — blocking is what the whole feature
rests on, so it is asserted from both sides and against every downstream effect
(further requests, matching visibility, messaging).
"""

import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from rest_framework.test import APIClient

from apps.accounts.authentication import SUPABASE_AUDIENCE
from apps.accounts.models import Profile
from apps.connections.models import Connection
from apps.connections.views import can_message

User = get_user_model()
SECRET = "test-jwt-secret"
BLR = (12.9716, 77.5946)


def make_token(sub):
    now = datetime.now(tz=timezone.utc)
    return jwt.encode(
        {
            "sub": str(sub),
            "email": "trav@example.com",
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


def make_traveller(username):
    user = User.objects.create_user(username=username)
    profile = Profile.objects.create(
        user=user,
        supabase_user_id=uuid.uuid4(),
        display_name=username.title(),
        interests=["food"],
        languages=["english"],
        budget_style="budget",
        age_band="21-23",
        gender="female",
        area_label=f"{username.title()} City",
        area_point=Point(BLR[1], BLR[0], srid=4326),
        onboarded=True,
        phone_verified=True,
    )
    return user, profile


def client_for(profile):
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {make_token(profile.supabase_user_id)}")
    return c


@pytest.fixture
def pair(settings_secret):
    alice_user, alice = make_traveller("alice")
    bob_user, bob = make_traveller("bob")
    return (alice_user, alice), (bob_user, bob)


# --- sending --------------------------------------------------------------


@pytest.mark.django_db
def test_send_creates_a_pending_request(pair):
    (_, alice), (_, bob) = pair

    response = client_for(alice).post(
        "/api/connections/", {"supabase_user_id": str(bob.supabase_user_id)}, format="json"
    )
    assert response.status_code == 201
    assert response.data["status"] == "pending"
    assert response.data["direction"] == "outgoing"
    assert response.data["other"]["display_name"] == "Bob"
    # The sender cannot answer their own request.
    assert response.data["can_act"] is False


@pytest.mark.django_db
def test_send_requires_authentication(pair):
    (_, _), (_, bob) = pair
    response = APIClient().post(
        "/api/connections/", {"supabase_user_id": str(bob.supabase_user_id)}, format="json"
    )
    assert response.status_code == 401


@pytest.mark.django_db
def test_cannot_connect_with_yourself(pair):
    (_, alice), _ = pair
    response = client_for(alice).post(
        "/api/connections/",
        {"supabase_user_id": str(alice.supabase_user_id)},
        format="json",
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_sending_to_an_unknown_traveller_is_400(pair):
    (_, alice), _ = pair
    response = client_for(alice).post(
        "/api/connections/", {"supabase_user_id": str(uuid.uuid4())}, format="json"
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_duplicate_request_is_409_and_returns_the_existing_connection(pair):
    (_, alice), (_, bob) = pair
    client = client_for(alice)
    payload = {"supabase_user_id": str(bob.supabase_user_id)}

    assert client.post("/api/connections/", payload, format="json").status_code == 201
    second = client.post("/api/connections/", payload, format="json")

    assert second.status_code == 409
    assert second.data["code"] == "already_pending"
    assert second.data["connection"]["status"] == "pending"
    assert Connection.objects.count() == 1


@pytest.mark.django_db
def test_request_when_they_already_asked_you_points_at_their_request(pair):
    (alice_user, alice), (bob_user, bob) = pair
    Connection.objects.create(requester=bob_user, addressee=alice_user)

    response = client_for(alice).post(
        "/api/connections/", {"supabase_user_id": str(bob.supabase_user_id)}, format="json"
    )
    assert response.status_code == 409
    assert "accept it instead" in response.data["detail"]


# --- accept / decline -----------------------------------------------------


@pytest.mark.django_db
def test_addressee_can_accept(pair):
    (alice_user, alice), (bob_user, bob) = pair
    connection = Connection.objects.create(requester=alice_user, addressee=bob_user)

    response = client_for(bob).post(f"/api/connections/{connection.pk}/accept/")
    assert response.status_code == 200
    assert response.data["status"] == "accepted"
    connection.refresh_from_db()
    assert connection.status == Connection.Status.ACCEPTED


@pytest.mark.django_db
def test_addressee_can_decline(pair):
    (alice_user, alice), (bob_user, bob) = pair
    connection = Connection.objects.create(requester=alice_user, addressee=bob_user)

    response = client_for(bob).post(f"/api/connections/{connection.pk}/decline/")
    assert response.status_code == 200
    assert response.data["status"] == "declined"


@pytest.mark.django_db
def test_requester_cannot_accept_their_own_request(pair):
    (alice_user, alice), (bob_user, _) = pair
    connection = Connection.objects.create(requester=alice_user, addressee=bob_user)

    response = client_for(alice).post(f"/api/connections/{connection.pk}/accept/")
    assert response.status_code == 403
    connection.refresh_from_db()
    assert connection.status == Connection.Status.PENDING


@pytest.mark.django_db
def test_a_stranger_cannot_touch_someone_elses_connection(pair, settings_secret):
    (alice_user, _), (bob_user, _) = pair
    _, mallory = make_traveller("mallory")
    connection = Connection.objects.create(requester=alice_user, addressee=bob_user)

    client = client_for(mallory)
    # Not a participant: the object is not even visible.
    assert client.get(f"/api/connections/{connection.pk}/").status_code == 404
    assert client.post(f"/api/connections/{connection.pk}/accept/").status_code == 404


@pytest.mark.django_db
def test_cannot_accept_an_already_answered_request(pair):
    (alice_user, _), (bob_user, bob) = pair
    connection = Connection.objects.create(
        requester=alice_user, addressee=bob_user, status=Connection.Status.DECLINED
    )

    response = client_for(bob).post(f"/api/connections/{connection.pk}/accept/")
    assert response.status_code == 400


# --- blocking -------------------------------------------------------------


@pytest.mark.django_db
def test_either_participant_may_block(pair):
    (alice_user, alice), (bob_user, _) = pair
    connection = Connection.objects.create(requester=alice_user, addressee=bob_user)

    response = client_for(alice).post(f"/api/connections/{connection.pk}/block/")
    assert response.status_code == 200
    assert response.data["status"] == "blocked"

    connection.refresh_from_db()
    assert connection.blocked_by_id == alice_user.pk


@pytest.mark.django_db
def test_blocking_prevents_further_requests_from_either_side(pair):
    (alice_user, alice), (bob_user, bob) = pair
    Connection.objects.create(
        requester=alice_user,
        addressee=bob_user,
        status=Connection.Status.BLOCKED,
        blocked_by=alice_user,
    )

    # The blocked party cannot send a new request...
    blocked_attempt = client_for(bob).post(
        "/api/connections/",
        {"supabase_user_id": str(alice.supabase_user_id)},
        format="json",
    )
    assert blocked_attempt.status_code == 403
    # ...and the message does not confirm that a block is what stopped them.
    assert "block" not in str(blocked_attempt.data).lower()

    # Nor can the blocker re-request without unblocking first.
    assert (
        client_for(alice)
        .post(
            "/api/connections/",
            {"supabase_user_id": str(bob.supabase_user_id)},
            format="json",
        )
        .status_code
        == 403
    )


@pytest.mark.django_db
def test_blocking_revokes_messaging(pair):
    (alice_user, alice), (bob_user, _) = pair
    connection = Connection.objects.create(
        requester=alice_user, addressee=bob_user, status=Connection.Status.ACCEPTED
    )
    assert can_message(alice_user, bob_user) is True

    client_for(alice).post(f"/api/connections/{connection.pk}/block/")

    assert can_message(alice_user, bob_user) is False
    assert can_message(bob_user, alice_user) is False


@pytest.mark.django_db
def test_messaging_needs_an_accepted_connection(pair):
    (alice_user, _), (bob_user, _) = pair
    assert can_message(alice_user, bob_user) is False

    Connection.objects.create(requester=alice_user, addressee=bob_user)
    assert can_message(alice_user, bob_user) is False  # still pending


@pytest.mark.django_db
def test_only_the_blocker_may_unblock(pair):
    (alice_user, alice), (bob_user, bob) = pair
    connection = Connection.objects.create(
        requester=alice_user,
        addressee=bob_user,
        status=Connection.Status.BLOCKED,
        blocked_by=alice_user,
    )

    assert client_for(bob).post(f"/api/connections/{connection.pk}/unblock/").status_code == 403

    response = client_for(alice).post(f"/api/connections/{connection.pk}/unblock/")
    assert response.status_code == 200
    assert response.data["status"] == "declined"


# --- blocking directly (no prior connection) --------------------------------


@pytest.mark.django_db
def test_block_user_with_no_prior_connection_creates_a_blocked_row(pair):
    (alice_user, alice), (bob_user, bob) = pair
    assert not Connection.objects.exists()

    resp = client_for(alice).post(
        "/api/connections/block-user/",
        {"supabase_user_id": str(bob.supabase_user_id)},
        format="json",
    )
    assert resp.status_code == 200
    assert resp.data["status"] == "blocked"

    connection = Connection.objects.get()
    assert connection.status == Connection.Status.BLOCKED
    assert connection.blocked_by_id == alice_user.pk
    assert {connection.requester_id, connection.addressee_id} == {
        alice_user.pk,
        bob_user.pk,
    }


@pytest.mark.django_db
def test_block_user_updates_an_existing_pending_connection(pair):
    (alice_user, alice), (bob_user, bob) = pair
    Connection.objects.create(requester=bob_user, addressee=alice_user)  # Bob asked first

    resp = client_for(alice).post(
        "/api/connections/block-user/",
        {"supabase_user_id": str(bob.supabase_user_id)},
        format="json",
    )
    assert resp.status_code == 200
    assert Connection.objects.count() == 1  # updated, not duplicated
    connection = Connection.objects.get()
    assert connection.status == Connection.Status.BLOCKED
    assert connection.blocked_by_id == alice_user.pk


@pytest.mark.django_db
def test_blocked_traveller_is_excluded_from_buddy_matching(pair, settings_secret):
    # make_traveller already onboards both with a shared BLR-area point.
    (alice_user, alice), (bob_user, bob) = pair

    before = client_for(alice).get("/api/buddies/?radius_km=500")
    assert any(
        c["supabase_user_id"] == str(bob.supabase_user_id) for c in before.data["results"]
    )

    client_for(alice).post(
        "/api/connections/block-user/",
        {"supabase_user_id": str(bob.supabase_user_id)},
        format="json",
    )

    after = client_for(alice).get("/api/buddies/?radius_km=500")
    assert not any(
        c["supabase_user_id"] == str(bob.supabase_user_id) for c in after.data["results"]
    )


# --- canceling a sent request ----------------------------------------------


@pytest.mark.django_db
def test_requester_can_cancel_a_pending_request(pair):
    (alice_user, alice), (bob_user, bob) = pair
    connection = Connection.objects.create(requester=alice_user, addressee=bob_user)

    response = client_for(alice).delete(f"/api/connections/{connection.pk}/")
    assert response.status_code == 204
    assert not Connection.objects.filter(pk=connection.pk).exists()


@pytest.mark.django_db
def test_addressee_cannot_cancel_a_request_sent_to_them(pair):
    (alice_user, alice), (bob_user, bob) = pair
    connection = Connection.objects.create(requester=alice_user, addressee=bob_user)

    response = client_for(bob).delete(f"/api/connections/{connection.pk}/")
    assert response.status_code == 403
    assert Connection.objects.filter(pk=connection.pk).exists()


@pytest.mark.django_db
def test_cannot_cancel_an_already_answered_request(pair):
    (alice_user, alice), (bob_user, bob) = pair
    connection = Connection.objects.create(
        requester=alice_user, addressee=bob_user, status=Connection.Status.ACCEPTED
    )

    response = client_for(alice).delete(f"/api/connections/{connection.pk}/")
    assert response.status_code == 400
    assert Connection.objects.filter(pk=connection.pk).exists()


# --- listing --------------------------------------------------------------


@pytest.mark.django_db
def test_list_shows_both_directions_and_marks_actionable_requests(pair):
    (alice_user, alice), (bob_user, bob) = pair
    Connection.objects.create(requester=alice_user, addressee=bob_user)

    incoming = client_for(bob).get("/api/connections/?direction=incoming&status=pending")
    assert incoming.status_code == 200
    row = incoming.data["results"][0]
    assert row["direction"] == "incoming"
    assert row["can_act"] is True
    assert row["other"]["display_name"] == "Alice"

    outgoing = client_for(alice).get("/api/connections/?direction=outgoing")
    assert outgoing.data["results"][0]["can_act"] is False


@pytest.mark.django_db
def test_list_never_shows_other_peoples_connections(pair, settings_secret):
    (alice_user, _), (bob_user, _) = pair
    _, mallory = make_traveller("mallory")
    Connection.objects.create(requester=alice_user, addressee=bob_user)

    assert client_for(mallory).get("/api/connections/").data["results"] == []


@pytest.mark.django_db
def test_list_rejects_invalid_filters(pair):
    (_, alice), _ = pair
    client = client_for(alice)
    assert client.get("/api/connections/?direction=sideways").status_code == 400
    assert client.get("/api/connections/?status=maybe").status_code == 400


@pytest.mark.django_db
def test_connection_payload_carries_no_coordinates(pair):
    (alice_user, alice), (bob_user, _) = pair
    Connection.objects.create(requester=alice_user, addressee=bob_user)

    response = client_for(alice).get("/api/connections/")
    body = response.content.decode()
    for forbidden in ("area_point", "coordinates", '"lat"', '"lng"'):
        assert forbidden not in body
    assert set(response.data["results"][0]["other"]) == {
        "supabase_user_id",
        "display_name",
        "avatar_url",
        "bio",
        "travel_styles",
        "badges",
        "age_band",
        "gender",
        "languages",
        "interests",
        "budget_style",
        "area_label",
    }
