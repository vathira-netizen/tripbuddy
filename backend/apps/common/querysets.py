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


def visible_trips(user):
    """Trips the user owns or collaborates on."""
    return Trip.objects.filter(
        Q(owner=user) | Q(collaborators__user=user)
    ).distinct()


def visible_itinerary_items(user):
    return ItineraryItem.objects.filter(
        Q(trip__owner=user) | Q(trip__collaborators__user=user)
    ).distinct()


def visible_budget_items(user):
    return BudgetItem.objects.filter(
        Q(trip__owner=user) | Q(trip__collaborators__user=user)
    ).distinct()


def visible_connections(user):
    """Connections the user is either side of."""
    return Connection.objects.filter(Q(requester=user) | Q(addressee=user))


def accepted_connections(user):
    return visible_connections(user).filter(status=Connection.Status.ACCEPTED)


def blocked_user_ids(user):
    """Ids of travellers on a blocked connection with ``user``, in either direction.

    Phase 4 excludes these from match results; Phase 7 refuses messages to them.
    """
    blocked = visible_connections(user).filter(status=Connection.Status.BLOCKED)
    ids = set()
    for connection in blocked.values("requester_id", "addressee_id"):
        ids.add(connection["requester_id"])
        ids.add(connection["addressee_id"])
    ids.discard(user.pk)
    return ids


def visible_messages(user):
    """Messages on connections the user participates in."""
    return Message.objects.filter(
        Q(connection__requester=user) | Q(connection__addressee=user)
    )
