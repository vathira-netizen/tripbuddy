"""Messaging: gating, sanitisation, pagination and unread counts.

The gating tests carry the most weight. Django's write path and the Realtime
read path enforce the same "accepted connection" rule in two different places
(this module and the RLS policy in migration 0003), so the tests below pin the
half that lives in Python.
"""

import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.accounts.authentication import SUPABASE_AUDIENCE
from apps.accounts.models import Profile
from apps.connections.models import Connection
from apps.messaging.models import Message
from apps.messaging.serializers import MAX_BODY_LENGTH, sanitise_body

User = get_user_model()
SECRET = "test-jwt-secret"


def make_token(sub):
    now = datetime.now(tz=timezone.utc)
    return jwt.encode(
        {
            "sub": str(sub),
            "email": "t@example.com",
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
        onboarded=True,
        phone_verified=True,
    )
    return user, profile


def client_for(profile):
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {make_token(profile.supabase_user_id)}")
    return c


@pytest.fixture
def accepted(settings_secret):
    alice_user, alice = make_traveller("alice")
    bob_user, bob = make_traveller("bob")
    connection = Connection.objects.create(
        requester=alice_user, addressee=bob_user, status=Connection.Status.ACCEPTED
    )
    return connection, (alice_user, alice), (bob_user, bob)


def url(connection):
    return f"/api/connections/{connection.pk}/messages/"


# --- sanitisation (pure) --------------------------------------------------


def test_sanitise_trims_whitespace():
    assert sanitise_body("  hello  ") == "hello"


def test_sanitise_rejects_empty_and_whitespace_only():
    for value in ("", "   ", "\n\n", "\t"):
        with pytest.raises(Exception):
            sanitise_body(value)


def test_sanitise_rejects_overlong_bodies():
    assert sanitise_body("a" * MAX_BODY_LENGTH) == "a" * MAX_BODY_LENGTH
    with pytest.raises(Exception):
        sanitise_body("a" * (MAX_BODY_LENGTH + 1))


def test_sanitise_strips_control_characters():
    assert sanitise_body("he\x00l\x07lo") == "hello"


def test_sanitise_strips_bidi_overrides():
    # "Trojan Source": these reorder text visually without changing the bytes
    # a reviewer sees, so a message can display differently from what is stored.
    assert "\u202E" not in sanitise_body("safe\u202Etxet")


def test_sanitise_keeps_newlines_and_tabs_but_collapses_runs():
    assert sanitise_body("a\n\n\n\n\nb") == "a\n\nb"
    assert sanitise_body("a\tb") == "a\tb"


def test_sanitise_normalises_crlf():
    assert sanitise_body("a\r\nb") == "a\nb"


def test_sanitise_does_not_escape_html():
    # Escaping belongs at render (React escapes). Doing it here would store
    # "&lt;" forever and double-escape downstream.
    assert sanitise_body("5 < 10 & <b>bold</b>") == "5 < 10 & <b>bold</b>"
    assert sanitise_body("<script>alert(1)</script>") == "<script>alert(1)</script>"


def test_sanitise_rejects_non_text():
    with pytest.raises(Exception):
        sanitise_body(42)


# --- sending --------------------------------------------------------------


@pytest.mark.django_db
def test_participant_can_send_on_an_accepted_connection(accepted):
    connection, (_, alice), _ = accepted

    response = client_for(alice).post(url(connection), {"body": "Hi!"}, format="json")

    assert response.status_code == 201
    assert response.data["body"] == "Hi!"
    assert response.data["is_mine"] is True
    assert response.data["sender_name"] == "Alice"
    assert Message.objects.count() == 1


@pytest.mark.django_db
def test_sender_comes_from_the_token_not_the_payload(accepted):
    connection, (alice_user, alice), (bob_user, _) = accepted

    response = client_for(alice).post(
        url(connection), {"body": "Hi", "sender": bob_user.pk}, format="json"
    )

    assert response.status_code == 201
    assert Message.objects.get().sender_id == alice_user.pk


@pytest.mark.django_db
def test_sending_requires_authentication(accepted):
    connection, _, _ = accepted
    assert APIClient().post(url(connection), {"body": "Hi"}, format="json").status_code == 401


@pytest.mark.django_db
def test_empty_and_overlong_messages_are_rejected(accepted):
    connection, (_, alice), _ = accepted
    client = client_for(alice)

    assert client.post(url(connection), {"body": "   "}, format="json").status_code == 400
    assert client.post(url(connection), {}, format="json").status_code == 400
    assert (
        client.post(
            url(connection), {"body": "a" * (MAX_BODY_LENGTH + 1)}, format="json"
        ).status_code
        == 400
    )
    assert Message.objects.count() == 0


@pytest.mark.django_db
def test_html_in_a_message_is_stored_and_returned_verbatim(accepted):
    connection, (_, alice), _ = accepted
    payload = "<script>alert('xss')</script>"

    response = client_for(alice).post(url(connection), {"body": payload}, format="json")

    assert response.status_code == 201
    # Stored as text, not markup, and not double-escaped. The client renders it
    # through React, which escapes on output.
    assert Message.objects.get().body == payload
    assert response.data["body"] == payload


# --- gating ---------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize("state", ["pending", "declined", "blocked"])
def test_cannot_message_on_a_connection_that_is_not_accepted(settings_secret, state):
    alice_user, alice = make_traveller("alice")
    bob_user, bob = make_traveller("bob")
    connection = Connection.objects.create(
        requester=alice_user, addressee=bob_user, status=state
    )

    client = client_for(alice)
    assert client.post(url(connection), {"body": "Hi"}, format="json").status_code == 403
    assert client.get(url(connection)).status_code == 403
    assert Message.objects.count() == 0


@pytest.mark.django_db
def test_blocking_stops_an_existing_conversation(accepted):
    connection, (alice_user, alice), (_, bob) = accepted
    Message.objects.create(connection=connection, sender=alice_user, body="before")

    connection.status = Connection.Status.BLOCKED
    connection.blocked_by = alice_user
    connection.save(update_fields=["status", "blocked_by"])

    for who in (alice, bob):
        client = client_for(who)
        # Neither side can send...
        assert client.post(url(connection), {"body": "after"}, format="json").status_code == 403
        # ...nor read the history that already exists.
        assert client.get(url(connection)).status_code == 403


@pytest.mark.django_db
def test_a_stranger_cannot_read_or_write_someone_elses_conversation(accepted):
    connection, _, _ = accepted
    _, mallory = make_traveller("mallory")

    client = client_for(mallory)
    assert client.get(url(connection)).status_code == 403
    assert client.post(url(connection), {"body": "hi"}, format="json").status_code == 403


@pytest.mark.django_db
def test_refusal_does_not_reveal_why(accepted):
    """A blocked user must not learn whether they were blocked or the thread is gone."""
    connection, _, _ = accepted
    _, mallory = make_traveller("mallory")

    stranger = client_for(mallory).get(url(connection))
    missing = client_for(mallory).get("/api/connections/999999/messages/")

    assert stranger.status_code == missing.status_code == 403
    assert stranger.data["detail"] == missing.data["detail"]


# --- history --------------------------------------------------------------


@pytest.mark.django_db
def test_history_is_returned_oldest_last(accepted):
    connection, (alice_user, alice), (bob_user, _) = accepted
    for i in range(5):
        Message.objects.create(
            connection=connection,
            sender=alice_user if i % 2 == 0 else bob_user,
            body=f"m{i}",
        )

    response = client_for(alice).get(url(connection))

    assert response.status_code == 200
    assert [m["body"] for m in response.data["results"]] == ["m0", "m1", "m2", "m3", "m4"]


@pytest.mark.django_db
def test_first_page_is_the_most_recent_messages(accepted):
    connection, (alice_user, alice), _ = accepted
    for i in range(40):
        Message.objects.create(connection=connection, sender=alice_user, body=f"m{i}")

    page = client_for(alice).get(url(connection)).data

    # 30 per page: the newest 30 (m10..m39), oldest-to-newest within the page.
    bodies = [m["body"] for m in page["results"]]
    assert len(bodies) == 30
    assert bodies[0] == "m10"
    assert bodies[-1] == "m39"
    assert page["count"] == 40
    assert page["next"], "older messages should be reachable"


@pytest.mark.django_db
def test_history_only_contains_this_conversation(accepted, settings_secret):
    connection, (alice_user, alice), _ = accepted
    other_user, other = make_traveller("carol")
    elsewhere = Connection.objects.create(
        requester=alice_user, addressee=other_user, status=Connection.Status.ACCEPTED
    )
    Message.objects.create(connection=connection, sender=alice_user, body="here")
    Message.objects.create(connection=elsewhere, sender=alice_user, body="elsewhere")

    bodies = [m["body"] for m in client_for(alice).get(url(connection)).data["results"]]
    assert bodies == ["here"]


@pytest.mark.django_db
def test_is_mine_is_relative_to_the_reader(accepted):
    connection, (alice_user, alice), (_, bob) = accepted
    Message.objects.create(connection=connection, sender=alice_user, body="from alice")

    assert client_for(alice).get(url(connection)).data["results"][0]["is_mine"] is True
    assert client_for(bob).get(url(connection)).data["results"][0]["is_mine"] is False


# --- read state and badges ------------------------------------------------


@pytest.mark.django_db
def test_opening_a_thread_marks_received_messages_read(accepted):
    connection, (alice_user, alice), (bob_user, bob) = accepted
    Message.objects.create(connection=connection, sender=alice_user, body="hi")
    Message.objects.create(connection=connection, sender=bob_user, body="hello")

    response = client_for(bob).post(f"{url(connection)}read/")

    assert response.status_code == 200
    assert response.data["marked_read"] == 1
    # Bob's own message is untouched — that would corrupt Alice's unread count.
    assert Message.objects.get(sender=bob_user).read_at is None
    assert Message.objects.get(sender=alice_user).read_at is not None


@pytest.mark.django_db
def test_cannot_mark_read_on_a_conversation_that_is_not_yours(accepted):
    connection, _, _ = accepted
    _, mallory = make_traveller("mallory")
    assert client_for(mallory).post(f"{url(connection)}read/").status_code == 403


@pytest.mark.django_db
def test_summary_counts_unread_messages_and_pending_requests(accepted):
    connection, (alice_user, alice), (bob_user, bob) = accepted
    Message.objects.create(connection=connection, sender=alice_user, body="1")
    Message.objects.create(connection=connection, sender=alice_user, body="2")
    Message.objects.create(connection=connection, sender=bob_user, body="mine")

    carol_user, _ = make_traveller("carol")
    Connection.objects.create(requester=carol_user, addressee=bob_user)

    summary = client_for(bob).get("/api/messages/summary/").data

    assert summary["unread_messages"] == 2  # Bob's own message does not count
    assert summary["pending_requests"] == 1
    assert summary["unread_by_connection"][str(connection.pk)] == 2


@pytest.mark.django_db
def test_summary_ignores_non_accepted_connections(settings_secret):
    alice_user, _ = make_traveller("alice")
    bob_user, bob = make_traveller("bob")
    blocked = Connection.objects.create(
        requester=alice_user, addressee=bob_user, status=Connection.Status.BLOCKED
    )
    Message.objects.create(connection=blocked, sender=alice_user, body="old")

    summary = client_for(bob).get("/api/messages/summary/").data
    assert summary["unread_messages"] == 0
    assert summary["unread_by_connection"] == {}


@pytest.mark.django_db
def test_summary_requires_authentication():
    assert APIClient().get("/api/messages/summary/").status_code == 401


@pytest.mark.django_db
def test_summary_lists_notifications_for_messages_and_trip_joins(accepted):
    from apps.trips.models import Trip, TripJoinRequest

    connection, (alice_user, alice), (bob_user, bob) = accepted
    Message.objects.create(connection=connection, sender=alice_user, body="hello bob")
    trip = Trip.objects.create(owner=bob_user, title="Goa week", is_open_to_join=True)
    carol_user, _ = make_traveller("carol")
    TripJoinRequest.objects.create(trip=trip, requester=carol_user, message="can I come?")

    summary = client_for(bob).get("/api/messages/summary/").data

    assert summary["pending_trip_joins"] == 1
    kinds = {n["kind"]: n for n in summary["notifications"]}
    assert kinds["trip_join"]["title"] == "Carol wants to join Goa week"
    assert kinds["trip_join"]["href"] == f"/trips/{trip.pk}"
    assert kinds["message"]["preview"] == "hello bob"
    assert kinds["message"]["href"] == f"/messages?c={connection.pk}"

    # Alice owns no trip and has nothing unread: her bell is empty.
    alice_summary = client_for(alice).get("/api/messages/summary/").data
    assert alice_summary["pending_trip_joins"] == 0
    assert alice_summary["notifications"] == []


@pytest.mark.django_db
def test_clear_chat_hides_history_for_me_only(accepted):
    connection, (alice_user, alice), (bob_user, bob) = accepted
    Message.objects.create(connection=connection, sender=alice_user, body="old one")

    resp = client_for(bob).post(f"{url(connection)}clear/")
    assert resp.status_code == 200
    assert client_for(bob).get("/api/messages/summary/").data["unread_messages"] == 0

    Message.objects.create(connection=connection, sender=alice_user, body="new one")
    bob_view = [m["body"] for m in client_for(bob).get(url(connection)).data["results"]]
    alice_view = [m["body"] for m in client_for(alice).get(url(connection)).data["results"]]
    assert bob_view == ["new one"]
    assert alice_view == ["old one", "new one"]


@pytest.mark.django_db
def test_clear_chat_refuses_strangers(accepted, settings_secret):
    connection, _, _ = accepted
    _, mallory = make_traveller("mallory")
    assert client_for(mallory).post(f"{url(connection)}clear/").status_code == 403


@pytest.mark.django_db
def test_clear_trip_chat_hides_history_and_preview(accepted):
    from apps.messaging.models import TripMessage
    from apps.trips.models import Trip, TripCollaborator

    _, (alice_user, alice), (bob_user, bob) = accepted
    trip = Trip.objects.create(owner=alice_user, title="Goa week")
    TripCollaborator.objects.create(trip=trip, user=bob_user)
    TripMessage.objects.create(trip=trip, sender=alice_user, body="before")

    assert client_for(bob).post(f"/api/trips/{trip.pk}/messages/clear/").status_code == 200

    history = client_for(bob).get(f"/api/trips/{trip.pk}/messages/").data["results"]
    assert history == []
    chats = client_for(bob).get("/api/trip-chats/").data
    assert chats[0]["last_message"] is None and chats[0]["unread"] == 0
    # Alice still sees her message.
    assert len(client_for(alice).get(f"/api/trips/{trip.pk}/messages/").data["results"]) == 1
