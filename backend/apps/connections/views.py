"""Buddy connections: send a request, then accept / decline / block it.

State machine, enforced here rather than in the model so every transition has
one place to look:

    (none) --send--> pending --accept--> accepted
                        |
                        +----decline--> declined

    any state --block--> blocked --unblock--> declined

Blocking is the hard stop. A blocked pair cannot send further requests (see
``_existing_connection`` below), cannot see each other in
``/api/buddies/`` (``apps.matching.services.excluded_user_ids``), and cannot
message — ``can_message`` is the single predicate Phase 7's messaging endpoints
must consult, and the Message table's RLS policy backs it up for the direct
browser read path.
"""

from django.db import IntegrityError
from django.db.models import Q
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.common.permissions import IsConnectionParticipant, RequiresVerifiedPhone
from apps.common.querysets import is_authenticated, visible_connections
from apps.connections.models import Connection
from apps.connections.serializers import (
    ConnectionCreateSerializer,
    ConnectionSerializer,
)

# Shown when the other traveller has blocked the requester. Deliberately vague:
# confirming "you are blocked" tells someone their target's exact action.
BLOCKED_MESSAGE = "This traveller is not available."


def blocked_between(user_a_id, user_b_id):
    """Whether a block exists between the pair, in either direction."""
    return Connection.objects.filter(
        Q(requester_id=user_a_id, addressee_id=user_b_id)
        | Q(requester_id=user_b_id, addressee_id=user_a_id),
        status=Connection.Status.BLOCKED,
    ).exists()


def can_message(user, other):
    """Whether ``user`` may message ``other``.

    True only on an accepted connection with no block. Phase 7 must call this
    before writing a Message.
    """
    if not (is_authenticated(user) and other is not None):
        return False
    return Connection.objects.filter(
        Q(requester=user, addressee=other) | Q(requester=other, addressee=user),
        status=Connection.Status.ACCEPTED,
    ).exists()


class ConnectionViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """The requesting user's connections, in both directions.

    ``GET /api/connections/?direction=incoming&status=pending`` is what the
    incoming-requests panel polls.
    """

    serializer_class = ConnectionSerializer
    permission_classes = [IsAuthenticated, RequiresVerifiedPhone, IsConnectionParticipant]
    # Sending and accepting a request need a confirmed phone number.
    # Declining, blocking and unblocking stay open: they are safety actions.
    phone_verified_for = {"create", "accept"}

    def get_queryset(self):
        if not is_authenticated(self.request.user):
            return Connection.objects.none()

        qs = visible_connections(self.request.user).select_related(
            "requester__profile", "addressee__profile"
        )

        direction = self.request.query_params.get("direction")
        if direction == "incoming":
            qs = qs.filter(addressee=self.request.user)
        elif direction == "outgoing":
            qs = qs.filter(requester=self.request.user)
        elif direction:
            raise ValidationError(
                {"direction": "Must be 'incoming' or 'outgoing'."}
            )

        status_param = self.request.query_params.get("status")
        if status_param:
            valid = {c.value for c in Connection.Status}
            if status_param not in valid:
                raise ValidationError(
                    {"status": f"Must be one of {sorted(valid)}."}
                )
            qs = qs.filter(status=status_param)

        return qs

    @extend_schema(
        summary="Send a buddy request",
        request=ConnectionCreateSerializer,
        responses={201: ConnectionSerializer},
    )
    def create(self, request):
        serializer = ConnectionCreateSerializer(
            data=request.data, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        target = serializer.context["target_profile"]

        if blocked_between(request.user.pk, target.user_id):
            raise PermissionDenied(BLOCKED_MESSAGE)

        existing = self._existing_connection(request.user.pk, target.user_id)
        if existing is not None:
            # Already related in some way — 409 with the connection itself, so
            # the UI can show "accept their request" instead of a dead end.
            return Response(
                {
                    "detail": self._existing_detail(existing, request.user),
                    "code": f"already_{existing.status}",
                    "connection": ConnectionSerializer(
                        existing, context={"request": request}
                    ).data,
                },
                status=status.HTTP_409_CONFLICT,
            )

        try:
            connection = Connection.objects.create(
                requester=request.user, addressee=target.user
            )
        except IntegrityError:
            # Two rapid taps on Connect; the unique constraint won the race.
            existing = self._existing_connection(request.user.pk, target.user_id)
            if existing is None:
                raise
            return Response(
                {
                    "detail": self._existing_detail(existing, request.user),
                    "code": f"already_{existing.status}",
                    "connection": ConnectionSerializer(
                        existing, context={"request": request}
                    ).data,
                },
                status=status.HTTP_409_CONFLICT,
            )

        return Response(
            ConnectionSerializer(connection, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    def perform_destroy(self, instance):
        """``DELETE /api/connections/<id>/`` — the requester withdraws it.

        Only the sender may cancel, and only before it's been answered:
        answering is the addressee's call (accept/decline), not something the
        sender can pre-empt by deleting the row out from under them.
        """
        if instance.status != Connection.Status.PENDING:
            raise ValidationError(
                {"status": f"This request is already {instance.status}."}
            )
        if instance.requester_id != self.request.user.pk:
            raise PermissionDenied("Only the sender may cancel this request.")
        instance.delete()

    @extend_schema(
        summary="Block a traveller directly, with no prior connection required",
        description="Unlike the detail `block` action below, this addresses "
                    "the target by supabase_user_id rather than a connection "
                    "id — for blocking a stranger straight from their profile "
                    "or a chat header, where no Connection row exists yet.",
        request=ConnectionCreateSerializer,
        responses={200: ConnectionSerializer},
    )
    @action(detail=False, methods=["post"], url_path="block-user")
    def block_user(self, request):
        serializer = ConnectionCreateSerializer(
            data=request.data, context={"request": request}
        )
        # Runs the same target lookup as create(), but not its "cannot
        # connect with yourself" framing — blocking yourself is equally
        # nonsensical, so the same validation error is fine as-is.
        serializer.is_valid(raise_exception=True)
        target = serializer.context["target_profile"]

        connection = self._existing_connection(request.user.pk, target.user_id)
        if connection is None:
            connection = Connection.objects.create(
                requester=request.user,
                addressee=target.user,
                status=Connection.Status.BLOCKED,
                blocked_by=request.user,
            )
        else:
            connection.status = Connection.Status.BLOCKED
            connection.blocked_by = request.user
            connection.save(update_fields=["status", "blocked_by", "updated_at"])

        return Response(
            ConnectionSerializer(connection, context={"request": request}).data
        )

    @extend_schema(summary="Accept a pending request", request=None,
                   responses={200: ConnectionSerializer})
    @action(detail=True, methods=["post"])
    def accept(self, request, pk=None):
        return self._respond_to_request(request, Connection.Status.ACCEPTED)

    @extend_schema(summary="Decline a pending request", request=None,
                   responses={200: ConnectionSerializer})
    @action(detail=True, methods=["post"])
    def decline(self, request, pk=None):
        return self._respond_to_request(request, Connection.Status.DECLINED)

    @extend_schema(
        summary="Block the other traveller",
        description="Allowed from any state and by either participant. Stops "
                    "further requests, hides the pair from matching, and "
                    "revokes messaging.",
        request=None,
        responses={200: ConnectionSerializer},
    )
    @action(detail=True, methods=["post"])
    def block(self, request, pk=None):
        connection = self.get_object()
        connection.status = Connection.Status.BLOCKED
        connection.blocked_by = request.user
        connection.save(update_fields=["status", "blocked_by", "updated_at"])
        return Response(
            ConnectionSerializer(connection, context={"request": request}).data
        )

    @extend_schema(
        summary="Lift a block you applied",
        description="Only the participant who blocked may unblock. The pair "
                    "returns to 'declined', not to their previous state: "
                    "reinstating an accepted connection should be a deliberate "
                    "new request.",
        request=None,
        responses={200: ConnectionSerializer},
    )
    @action(detail=True, methods=["post"])
    def unblock(self, request, pk=None):
        connection = self.get_object()
        if connection.status != Connection.Status.BLOCKED:
            raise ValidationError({"status": "This connection is not blocked."})
        if connection.blocked_by_id != request.user.pk:
            raise PermissionDenied("Only the traveller who blocked may unblock.")

        connection.status = Connection.Status.DECLINED
        connection.blocked_by = None
        connection.save(update_fields=["status", "blocked_by", "updated_at"])
        return Response(
            ConnectionSerializer(connection, context={"request": request}).data
        )

    def _respond_to_request(self, request, new_status):
        connection = self.get_object()

        if connection.status != Connection.Status.PENDING:
            raise ValidationError(
                {"status": f"This request is already {connection.status}."}
            )
        # Only the person who received the request may answer it.
        if connection.addressee_id != request.user.pk:
            raise PermissionDenied("Only the recipient may answer this request.")

        connection.status = new_status
        connection.save(update_fields=["status", "updated_at"])
        return Response(
            ConnectionSerializer(connection, context={"request": request}).data
        )

    @staticmethod
    def _existing_connection(user_a_id, user_b_id):
        return Connection.objects.filter(
            Q(requester_id=user_a_id, addressee_id=user_b_id)
            | Q(requester_id=user_b_id, addressee_id=user_a_id)
        ).first()

    @staticmethod
    def _existing_detail(connection, user):
        if connection.status == Connection.Status.ACCEPTED:
            return "You are already connected with this traveller."
        if connection.status == Connection.Status.PENDING:
            if connection.addressee_id == user.pk:
                return "This traveller already sent you a request — accept it instead."
            return "You already sent this traveller a request."
        if connection.status == Connection.Status.DECLINED:
            return "This request was already answered."
        return BLOCKED_MESSAGE
