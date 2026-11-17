"""Trip group chat: membership gating, receipts, unread counts, emoji."""

import pytest

from apps.messaging.models import TripMessage
from apps.messaging.tests import client_for, make_traveller, settings_secret  # noqa: F401
from apps.trips.models import Trip, TripCollaborator

pytestmark = pytest.mark.django_db


@pytest.fixture
def group(settings_secret):  # noqa: F811
    owner_user, owner = make_traveller("olive")
    friend_user, friend = make_traveller("finn")
    _, outsider = make_traveller("omar")
    trip = Trip.objects.create(owner=owner_user, title="Goa")
    TripCollaborator.objects.create(trip=trip, user=friend_user)
    return trip, owner, friend, outsider


def url(trip):
    return f"/api/trips/{trip.pk}/messages/"


def test_members_chat_and_outsiders_are_refused(group):
    trip, owner, friend, outsider = group
    assert client_for(owner).post(url(trip), {"body": "hi 👋"}).status_code == 201
    assert client_for(friend).get(url(trip)).data["results"][0]["body"] == "hi 👋"
    assert client_for(outsider).get(url(trip)).status_code == 403
    assert client_for(outsider).post(url(trip), {"body": "x"}).status_code == 403


def test_seen_by_counts_other_members_who_read(group):
    trip, owner, friend, _ = group
    sent = client_for(owner).post(url(trip), {"body": "plan?"}).data
    assert sent["seen_by"] == 0

    client_for(friend).post(url(trip) + "read/")
    got = client_for(owner).get(url(trip)).data["results"][0]
    assert got["seen_by"] == 1

    # The sender reading their own chat is not a receipt.
    client_for(owner).post(url(trip) + "read/")
    assert client_for(owner).get(url(trip)).data["results"][0]["seen_by"] == 1


def test_unread_counts_exclude_own_messages_and_clear_on_read(group):
    trip, owner, friend, _ = group
    client_for(owner).post(url(trip), {"body": "one"})
    client_for(owner).post(url(trip), {"body": "two"})
    client_for(friend).post(url(trip), {"body": "mine"})

    summary = client_for(friend).get("/api/messages/summary/").data
    assert summary["unread_by_trip"] == {str(trip.pk): 2}
    assert summary["unread_messages"] == 2
    assert client_for(owner).get("/api/messages/summary/").data["unread_by_trip"] == {
        str(trip.pk): 1
    }

    client_for(friend).post(url(trip) + "read/")
    assert client_for(friend).get("/api/messages/summary/").data["unread_by_trip"] == {}


def test_trip_chat_list_only_shows_groups(group):
    trip, owner, friend, outsider = group
    solo = Trip.objects.create(owner=owner.user, title="Solo")  # no collaborators
    client_for(owner).post(url(trip), {"body": "hello"})

    rows = client_for(friend).get("/api/trip-chats/").data
    assert [r["id"] for r in rows] == [trip.pk]
    assert rows[0]["last_message"]["body"] == "hello"
    assert solo.pk not in [r["id"] for r in client_for(owner).get("/api/trip-chats/").data]
    assert client_for(outsider).get("/api/trip-chats/").data == []


def test_emoji_survive_round_trip(group):
    trip, owner, _, _ = group
    body = "Beach day 🏖️ ❤️ 👨‍👩‍👧"
    client_for(owner).post(url(trip), {"body": body})
    assert TripMessage.objects.get().body == body
