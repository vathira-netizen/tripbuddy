"""Per-user queryset scoping.

Each helper answers "which rows of this table is `user` allowed to see?". Every
``get_queryset`` in the project starts from one of these, so a list endpoint can
never return another traveller's rows even if a filter is forgotten.
"""

from django.db.models import Q

from apps.budgets.models import BudgetItem
from apps.connections.models import Connection
from apps.messaging.models import Message
from apps.trips.models import ItineraryItem, Trip


def is_authenticated(user):
    """Whether ``user`` is a real, signed-in user.

    Every helper below short-circuits to an empty queryset when this is false.
    DRF's IsAuthenticated already rejects anonymous requests before they reach a
    ``get_queryset``, so this is belt-and-braces — but filtering on
    ``AnonymousUser`` otherwise raises, and "scope to nothing" is the only safe
    answer for a caller we cannot identify.
    """
    return bool(user and getattr(user, "is_authenticated", False))


def visible_trips(user):
    """Trips the user owns or collaborates on."""
    if not is_authenticated(user):
        return Trip.objects.none()
    return Trip.objects.filter(
        Q(owner=user) | Q(collaborators__user=user)
    ).distinct()


def visible_itinerary_items(user):
    if not is_authenticated(user):
        return ItineraryItem.objects.none()
    return ItineraryItem.objects.filter(
        Q(trip__owner=user) | Q(trip__collaborators__user=user)
    ).distinct()


def visible_budget_items(user):
    if not is_authenticated(user):
        return BudgetItem.objects.none()
    return BudgetItem.objects.filter(
        Q(trip__owner=user) | Q(trip__collaborators__user=user)
    ).distinct()


def visible_connections(user):
    """Connections the user is either side of."""
    if not is_authenticated(user):
        return Connection.objects.none()
    return Connection.objects.filter(Q(requester=user) | Q(addressee=user))


def accepted_connections(user):
    return visible_connections(user).filter(status=Connection.Status.ACCEPTED)


def blocked_user_ids(user):
    """Ids of travellers on a blocked connection with ``user``, in either direction.

    Phase 4 excludes these from match results; Phase 7 refuses messages to them.
    """
    if not is_authenticated(user):
        return set()
    blocked = visible_connections(user).filter(status=Connection.Status.BLOCKED)
    ids = set()
    for connection in blocked.values("requester_id", "addressee_id"):
        ids.add(connection["requester_id"])
        ids.add(connection["addressee_id"])
    ids.discard(user.pk)
    return ids


def visible_messages(user):
    """Messages on connections the user participates in."""
    if not is_authenticated(user):
        return Message.objects.none()
    return Message.objects.filter(
        Q(connection__requester=user) | Q(connection__addressee=user)
    )
