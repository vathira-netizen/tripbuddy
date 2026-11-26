"""Object-level permissions shared by every app.

Django connects to Supabase Postgres as a privileged role and therefore
*bypasses* Row-Level Security. Authorization for the API is enforced here and in
``apps.common.querysets`` — RLS (see the messaging/destinations SQL migrations)
only guards the direct-from-browser read path used by Supabase Realtime.

Every permission below is paired with a queryset filter: the filter is what
prevents leaking objects in list views, the permission is what stops a guessed
pk in a detail view.
"""

from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied

from apps.connections.models import Connection
from apps.trips.models import Trip, TripCollaborator


class IsOwner(permissions.BasePermission):
    """Object has a ``user`` FK pointing at its sole owner."""

    message = "You do not have access to this object."

    def has_object_permission(self, request, view, obj):
        return obj.user_id == request.user.pk


class IsSelfProfile(permissions.BasePermission):
    """The Profile being addressed must belong to the requesting user."""

    message = "You may only access your own profile."

    def has_object_permission(self, request, view, obj):
        return obj.user_id == request.user.pk


class IsTripMember(permissions.BasePermission):
    """Any member of the trip may read it; the owner and editors may change it.

    Accepts the Trip itself or anything with a ``trip`` FK (itinerary items,
    budget items), so Phases 3/5/6 can reuse it unchanged.
    """

    message = "You are not a member of this trip."

    def has_object_permission(self, request, view, obj):
        trip = obj if isinstance(obj, Trip) else getattr(obj, "trip", None)
        if trip is None or not is_trip_member(request.user, trip):
            return False
        if request.method in permissions.SAFE_METHODS or can_edit_trip(request.user, trip):
            return True
        self.message = VIEW_ONLY_MESSAGE
        return False


class IsTripOwner(permissions.BasePermission):
    """Only the trip owner — for destructive or sharing actions."""

    message = "Only the trip owner may do this."

    def has_object_permission(self, request, view, obj):
        trip = obj if isinstance(obj, Trip) else getattr(obj, "trip", None)
        return trip is not None and trip.owner_id == request.user.pk


class IsConnectionParticipant(permissions.BasePermission):
    """One of the two travellers on the connection."""

    message = "You are not a participant in this connection."

    def has_object_permission(self, request, view, obj):
        connection = obj if isinstance(obj, Connection) else getattr(obj, "connection", None)
        if connection is None:
            return False
        return request.user.pk in (connection.requester_id, connection.addressee_id)


class IsReadOnly(permissions.BasePermission):
    """Public catalogue data: anyone authenticated reads, nobody writes."""

    def has_permission(self, request, view):
        return request.method in permissions.SAFE_METHODS


VIEW_ONLY_MESSAGE = "You have view-only access to this trip."


def can_edit_trip(user, trip):
    """The owner, or a collaborator whose role isn't viewer."""
    if trip.owner_id == user.pk:
        return True
    return (
        TripCollaborator.objects.filter(trip=trip, user=user)
        .exclude(role=TripCollaborator.Role.VIEWER)
        .exists()
    )


def require_trip_editor(user, trip):
    """403 for a member who may only view. Call after the membership check."""
    if not can_edit_trip(user, trip):
        raise PermissionDenied(VIEW_ONLY_MESSAGE)


def is_trip_member(user, trip):
    if trip.owner_id == user.pk:
        return True
    return TripCollaborator.objects.filter(trip=trip, user=user).exists()
