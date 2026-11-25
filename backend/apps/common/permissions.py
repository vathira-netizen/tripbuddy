"""Object-level permissions shared by every app.

Django connects to Supabase Postgres as a privileged role and therefore
*bypasses* Row-Level Security. Authorization for the API is enforced here and in
``apps.common.querysets`` — RLS (see the messaging/destinations SQL migrations)
only guards the direct-from-browser read path used by Supabase Realtime.

Every permission below is paired with a queryset filter: the filter is what
prevents leaking objects in list views, the permission is what stops a guessed
pk in a detail view.
"""

from rest_framework import exceptions, permissions

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
    """Owner or collaborator of the trip may read and write it.

    Accepts the Trip itself or anything with a ``trip`` FK (itinerary items,
    budget items), so Phases 3/5/6 can reuse it unchanged.
    """

    message = "You are not a member of this trip."

    def has_object_permission(self, request, view, obj):
        trip = obj if isinstance(obj, Trip) else getattr(obj, "trip", None)
        if trip is None:
            return False
        return is_trip_member(request.user, trip)


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


PHONE_VERIFICATION_REQUIRED = "phone_verification_required"


class PhoneVerificationRequired(exceptions.PermissionDenied):
    """403 whose body carries a stable ``code`` the frontend can detect."""

    def __init__(self):
        super().__init__(
            {
                "detail": "Verify your phone number to use buddy features.",
                "code": PHONE_VERIFICATION_REQUIRED,
            }
        )


class RequiresVerifiedPhone(permissions.BasePermission):
    """Buddy features are only for travellers with a confirmed phone number.

    A view narrows which requests are gated with ``phone_verified_for``: a set
    of viewset action names and/or HTTP methods. Without it, every request to
    the view is gated. List it after ``IsAuthenticated`` so a signed-out
    request still gets a 401.
    """

    def has_permission(self, request, view):
        gated = getattr(view, "phone_verified_for", None)
        if gated is not None and not (
            getattr(view, "action", None) in gated or request.method in gated
        ):
            return True
        user = request.user
        if not (user and user.is_authenticated):
            return True  # IsAuthenticated answers this one.
        profile = getattr(user, "profile", None)
        if profile is None or not profile.phone_verified:
            raise PhoneVerificationRequired()
        return True


class IsReadOnly(permissions.BasePermission):
    """Public catalogue data: anyone authenticated reads, nobody writes."""

    def has_permission(self, request, view):
        return request.method in permissions.SAFE_METHODS


def is_trip_member(user, trip):
    if trip.owner_id == user.pk:
        return True
    return TripCollaborator.objects.filter(trip=trip, user=user).exists()
