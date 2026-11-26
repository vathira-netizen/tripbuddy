"""Authorization / queryset-scoping tests spanning multiple apps.

These lock in the core Phase-1 guarantee: a traveller can reach only their own
rows, trips they belong to, and connections/messages they participate in.
"""

import uuid

import pytest
from django.contrib.auth import get_user_model

from apps.budgets.models import BudgetItem
from apps.common import querysets
from apps.connections.models import Connection
from apps.messaging.models import Message
from apps.trips.models import ItineraryItem, Trip, TripCollaborator

User = get_user_model()


def make_user(email):
    from apps.accounts.models import Profile

    user = User.objects.create_user(username=str(uuid.uuid4()), email=email)
    Profile.objects.create(user=user, supabase_user_id=uuid.uuid4())
    return user


@pytest.fixture
def users(db):
    return make_user("a@x.com"), make_user("b@x.com"), make_user("c@x.com")


@pytest.mark.django_db
def test_visible_trips_covers_owned_and_collaborating(users):
    a, b, c = users
    owned = Trip.objects.create(owner=a, title="A's trip")
    shared = Trip.objects.create(owner=b, title="B's trip")
    TripCollaborator.objects.create(trip=shared, user=a)
    Trip.objects.create(owner=c, title="C's trip")

    visible = set(querysets.visible_trips(a).values_list("id", flat=True))
    assert visible == {owned.id, shared.id}


@pytest.mark.django_db
def test_visible_itinerary_and_budget_follow_membership(users):
    a, b, _ = users
    trip = Trip.objects.create(owner=b, title="B's trip")
    item = ItineraryItem.objects.create(trip=trip, title="Museum")
    bud = BudgetItem.objects.create(
        trip=trip, category="Food", label="Lunch", amount=200
    )

    assert not querysets.visible_itinerary_items(a).exists()
    assert not querysets.visible_budget_items(a).exists()

    TripCollaborator.objects.create(trip=trip, user=a)
    assert item in querysets.visible_itinerary_items(a)
    assert bud in querysets.visible_budget_items(a)


@pytest.mark.django_db
def test_visible_connections_and_messages_are_participant_only(users):
    a, b, c = users
    conn = Connection.objects.create(
        requester=a, addressee=b, status=Connection.Status.ACCEPTED
    )
    msg = Message.objects.create(connection=conn, sender=a, body="hi")

    assert conn in querysets.visible_connections(a)
    assert conn in querysets.visible_connections(b)
    assert conn not in querysets.visible_connections(c)

    assert msg in querysets.visible_messages(b)
    assert msg not in querysets.visible_messages(c)


@pytest.mark.django_db
def test_blocked_user_ids(users):
    a, b, c = users
    Connection.objects.create(
        requester=a, addressee=b, status=Connection.Status.BLOCKED, blocked_by=a
    )
    Connection.objects.create(
        requester=c, addressee=a, status=Connection.Status.ACCEPTED
    )
    blocked = querysets.blocked_user_ids(a)
    assert blocked == {b.pk}


@pytest.mark.django_db
def test_object_permissions(users):
    from types import SimpleNamespace

    from apps.common.permissions import IsConnectionParticipant, IsTripMember, IsTripOwner

    a, b, c = users
    trip = Trip.objects.create(owner=a, title="A's")
    TripCollaborator.objects.create(trip=trip, user=b)
    item = ItineraryItem.objects.create(trip=trip, title="x")
    conn = Connection.objects.create(requester=a, addressee=b)

    req = lambda u: SimpleNamespace(user=u, method="PATCH")

    assert IsTripMember().has_object_permission(req(a), None, trip)
    assert IsTripMember().has_object_permission(req(b), None, item)
    assert not IsTripMember().has_object_permission(req(c), None, trip)

    assert IsTripOwner().has_object_permission(req(a), None, trip)
    assert not IsTripOwner().has_object_permission(req(b), None, trip)

    assert IsConnectionParticipant().has_object_permission(req(a), None, conn)
    assert not IsConnectionParticipant().has_object_permission(req(c), None, conn)
