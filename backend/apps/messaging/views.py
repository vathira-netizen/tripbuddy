"""Messaging API.

Django owns the **write** path; the browser reads new messages directly from
Postgres over Supabase Realtime. Both paths are gated on the same rule — the
connection must be ``accepted`` — but they enforce it in different places:

* here, by :class:`IsAcceptedConnectionParticipant`, on every request;
* there, by the RLS policy on ``messaging_message`` (migration 0003), which
  Realtime evaluates per subscriber.

Keeping both in step matters: relaxing one without the other is exactly how a
blocked traveller keeps reading a conversation.
"""

from django.db.models import Count, F, OuterRef, Q, Subquery
from django.utils import timezone
from drf_spectacular.utils import OpenApiResponse, OpenApiTypes, extend_schema
from rest_framework import generics, permissions, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.querysets import is_authenticated, visible_trips
from apps.connections.models import Connection
from apps.messaging.models import (
    ChatClear,
    Message,
    TripChatRead,
    TripMessage,
    cleared_at,
)
from apps.trips.models import TripJoinRequest
from apps.messaging.serializers import (
    MessageSerializer,
    TripChatSerializer,
    TripMessageSerializer,
    UnreadSummarySerializer,
)

# Deliberately vague, and identical whether the connection does not exist, is
# not yours, or is blocked — the response must not tell a blocked user which.
NO_ACCESS = "This conversation is not available."


class IsAcceptedConnectionParticipant(permissions.BasePermission):
    """Both participants of an accepted connection, and nobody else.

    Blocking, declining and withdrawing all move the status away from
    ``accepted``, so this single check covers every one of them.
    """

    message = NO_ACCESS

    def has_object_permission(self, request, view, obj):
        if obj.status != Connection.Status.ACCEPTED:
            return False
        return request.user.pk in (obj.requester_id, obj.addressee_id)


class MessagePagination(PageNumberPagination):
    """Newest page first, but each page ordered oldest-to-newest.

    A chat wants the *most recent* messages on the first request, yet rendered
    with the newest at the bottom. So the queryset is sliced newest-first — page
    1 is the tail of the conversation, ``next`` walks backwards through history
    — and each page is reversed before serialisation, leaving the newest last.
    """

    page_size = 30
    page_size_query_param = "page_size"
    max_page_size = 100

    def paginate_queryset(self, queryset, request, view=None):
        page = super().paginate_queryset(queryset, request, view=view)
        return None if page is None else list(reversed(page))


def get_accepted_connection(user, pk):
    """Fetch the connection or refuse, without revealing which reason applies."""
    if not is_authenticated(user):
        raise PermissionDenied(NO_ACCESS)

    connection = Connection.objects.filter(pk=pk).first()
    if connection is None:
        raise PermissionDenied(NO_ACCESS)
    if user.pk not in (connection.requester_id, connection.addressee_id):
        raise PermissionDenied(NO_ACCESS)
    if connection.status != Connection.Status.ACCEPTED:
        raise PermissionDenied(NO_ACCESS)
    return connection


class ConnectionMessagesView(generics.ListCreateAPIView):
    """``GET`` conversation history / ``POST`` a new message.

    ``/api/connections/{id}/messages/``
    """

    serializer_class = MessageSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = MessagePagination
    throttle_scope = "messages"  # sends only; reading/polling is free

    def get_connection(self):
        if not hasattr(self, "_connection"):
            self._connection = get_accepted_connection(
                self.request.user, self.kwargs["pk"]
            )
        return self._connection

    def get_queryset(self):
        connection = self.get_connection()
        qs = Message.objects.filter(connection=connection)
        since = cleared_at(self.request.user, connection=connection)
        if since:
            qs = qs.filter(created_at__gt=since)
        # Newest first for slicing; MessagePagination flips each page back.
        return qs.select_related("sender__profile").order_by("-created_at", "-id")

    @extend_schema(
        summary="Conversation history",
        description="Most recent page first; within a page, oldest to newest.",
        responses=MessageSerializer(many=True),
    )
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    @extend_schema(
        summary="Send a message",
        description="Only on an accepted connection. The sender is always the "
                    "requesting user; a sender field in the body is ignored.",
        responses={201: MessageSerializer},
    )
    def post(self, request, *args, **kwargs):
        return super().post(request, *args, **kwargs)

    def perform_create(self, serializer):
        # sender comes from the token, never from the payload.
        serializer.save(connection=self.get_connection(), sender=self.request.user)


class MarkConversationReadView(APIView):
    """``POST /api/connections/{id}/messages/read/`` — mark the thread read.

    Marks only messages *received*, never your own: a sender has by definition
    read what they wrote, and stamping their own rows would corrupt the other
    side's unread count.
    """

    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(
        summary="Mark a conversation as read",
        request=None,
        responses=OpenApiResponse(
            response=OpenApiTypes.OBJECT, description='`{"marked_read": 3}`'
        ),
    )
    def post(self, request, pk):
        connection = get_accepted_connection(request.user, pk)
        marked = (
            Message.objects.filter(connection=connection, read_at__isnull=True)
            .exclude(sender=request.user)
            .update(read_at=timezone.now())
        )
        return Response({"marked_read": marked}, status=status.HTTP_200_OK)


class ClearConversationView(APIView):
    """``POST /api/connections/{id}/messages/clear/`` — clear the chat for you.

    Hides everything sent so far from *your* history only (the other traveller
    keeps theirs) and marks it read, so no badge is left pointing at it.
    """

    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(summary="Clear a conversation (for you only)", request=None,
                   responses=OpenApiTypes.OBJECT)
    def post(self, request, pk):
        connection = get_accepted_connection(request.user, pk)
        now = timezone.now()
        ChatClear.objects.update_or_create(
            user=request.user, connection=connection, defaults={"cleared_at": now}
        )
        Message.objects.filter(connection=connection, read_at__isnull=True).exclude(
            sender=request.user
        ).update(read_at=now)
        return Response({"cleared_at": now})


class UnreadSummaryView(APIView):
    """``GET /api/messages/summary/`` — everything the navbar badges need.

    One request, two counts, plus a per-conversation breakdown so the
    conversation list can show its own badges without N further calls.
    """

    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(
        summary="Unread messages and pending requests",
        responses=UnreadSummarySerializer,
    )
    def get(self, request):
        user = request.user

        rows = (
            Message.objects.filter(
                Q(connection__requester=user) | Q(connection__addressee=user),
                connection__status=Connection.Status.ACCEPTED,
                read_at__isnull=True,
            )
            .exclude(sender=user)
            .values("connection_id")
            .annotate(n=Count("id"))
        )
        by_connection = {str(r["connection_id"]): r["n"] for r in rows}

        pending = Connection.objects.filter(
            addressee=user, status=Connection.Status.PENDING
        ).count()

        by_trip = {str(k): v for k, v in trip_unread_counts(user).items()}

        trip_joins = list(
            TripJoinRequest.objects.filter(
                trip__owner=user, status=TripJoinRequest.Status.PENDING
            ).select_related("trip", "requester__profile")[:NOTIFICATION_LIMIT]
        )

        serializer = UnreadSummarySerializer(
            {
                "unread_messages": sum(by_connection.values()) + sum(by_trip.values()),
                "pending_requests": pending,
                "pending_trip_joins": TripJoinRequest.objects.filter(
                    trip__owner=user, status=TripJoinRequest.Status.PENDING
                ).count(),
                "unread_by_connection": by_connection,
                "unread_by_trip": by_trip,
                "notifications": _notifications(user, by_connection, by_trip, trip_joins),
            }
        )
        return Response(serializer.data)


NOTIFICATION_LIMIT = 20


def _name(user):
    profile = getattr(user, "profile", None)
    return (profile.display_name if profile else "") or "A traveller"


def _notifications(user, by_connection, by_trip, trip_joins):
    """The bell's list, newest first — derived from existing rows, not stored.

    One item per conversation / trip chat (with its unread count and latest
    message), per pending buddy request, and per pending trip-join request.
    ``key`` changes whenever there's something new, so the client can tell
    which items it hasn't seen yet.
    """
    items = []

    for conn_id, n in by_connection.items():
        latest = (
            Message.objects.filter(connection_id=conn_id, read_at__isnull=True)
            .exclude(sender=user)
            .select_related("sender__profile")
            .order_by("-created_at")
            .first()
        )
        if latest:
            items.append({
                "kind": "message",
                "key": f"message:{latest.pk}",
                "title": f"{_name(latest.sender)} sent you "
                         + ("a message" if n == 1 else f"{n} messages"),
                "preview": latest.body[:100],
                "href": f"/messages?c={conn_id}",
                "created_at": latest.created_at,
            })

    for trip_id, n in by_trip.items():
        latest = (
            TripMessage.objects.filter(trip_id=trip_id)
            .exclude(sender=user)
            .select_related("sender__profile", "trip")
            .order_by("-created_at")
            .first()
        )
        if latest:
            items.append({
                "kind": "trip_chat",
                "key": f"trip_chat:{latest.pk}",
                "title": f"{n} new message{'s' if n != 1 else ''} in {latest.trip.title}",
                "preview": f"{_name(latest.sender)}: {latest.body[:90]}",
                "href": f"/messages?t={trip_id}",
                "created_at": latest.created_at,
            })

    for jr in trip_joins:
        items.append({
            "kind": "trip_join",
            "key": f"trip_join:{jr.pk}",
            "title": f"{_name(jr.requester)} wants to join {jr.trip.title}",
            "preview": jr.message,
            "href": f"/trips/{jr.trip_id}",
            "created_at": jr.created_at,
        })

    buddy_requests = (
        Connection.objects.filter(addressee=user, status=Connection.Status.PENDING)
        .select_related("requester__profile")
        .order_by("-created_at")[:NOTIFICATION_LIMIT]
    )
    for c in buddy_requests:
        items.append({
            "kind": "buddy_request",
            "key": f"buddy_request:{c.pk}",
            "title": f"{_name(c.requester)} wants to be your travel buddy",
            "preview": "",
            "href": "/connections",
            "created_at": c.created_at,
        })

    items.sort(key=lambda i: i["created_at"], reverse=True)
    return items[:NOTIFICATION_LIMIT]


# --- Trip group chat ---------------------------------------------------------
# Any trip member (owner or collaborator) may read and write; a "group" is just
# a trip with collaborators, so inviting a friend to a trip is what creates one.


def get_member_trip(user, pk):
    """The trip, or refuse — same vague answer for "missing" and "not yours"."""
    trip = visible_trips(user).filter(pk=pk).first() if is_authenticated(user) else None
    if trip is None:
        raise PermissionDenied(NO_ACCESS)
    return trip


def trip_unread_counts(user):
    """{trip_id: unread} over the user's trips, excluding their own messages."""
    last_read = TripChatRead.objects.filter(
        trip=OuterRef("trip"), user=user
    ).values("last_read_at")[:1]
    rows = (
        TripMessage.objects.filter(trip_id__in=visible_trips(user).values("pk"))
        .exclude(sender=user)
        .annotate(lr=Subquery(last_read))
        .filter(Q(lr__isnull=True) | Q(created_at__gt=F("lr")))
        .values("trip_id")
        .annotate(n=Count("id"))
    )
    return {r["trip_id"]: r["n"] for r in rows}


class TripMessagesView(generics.ListCreateAPIView):
    """``GET``/``POST /api/trips/{id}/messages/`` — the trip's group chat."""

    serializer_class = TripMessageSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = MessagePagination
    throttle_scope = "messages"  # sends only; reading/polling is free

    def get_trip(self):
        if not hasattr(self, "_trip"):
            self._trip = get_member_trip(self.request.user, self.kwargs["pk"])
        return self._trip

    def get_queryset(self):
        qs = TripMessage.objects.filter(trip=self.get_trip())
        since = cleared_at(self.request.user, trip=self.get_trip())
        if since:
            qs = qs.filter(created_at__gt=since)
        return qs.select_related("sender__profile").order_by("-created_at", "-id")

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if self.request is not None and is_authenticated(self.request.user):
            context["reads"] = list(
                TripChatRead.objects.filter(trip=self.get_trip()).values_list(
                    "user_id", "last_read_at"
                )
            )
        return context

    def perform_create(self, serializer):
        serializer.save(trip=self.get_trip(), sender=self.request.user)


class TripChatReadView(APIView):
    """``POST /api/trips/{id}/messages/read/`` — mark the group chat read."""

    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    def post(self, request, pk):
        trip = get_member_trip(request.user, pk)
        TripChatRead.objects.update_or_create(
            trip=trip, user=request.user, defaults={"last_read_at": timezone.now()}
        )
        return Response({"ok": True})


class TripChatClearView(APIView):
    """``POST /api/trips/{id}/messages/clear/`` — clear the group chat for you."""

    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(summary="Clear a trip group chat (for you only)", request=None,
                   responses=OpenApiTypes.OBJECT)
    def post(self, request, pk):
        trip = get_member_trip(request.user, pk)
        now = timezone.now()
        ChatClear.objects.update_or_create(
            user=request.user, trip=trip, defaults={"cleared_at": now}
        )
        TripChatRead.objects.update_or_create(
            trip=trip, user=request.user, defaults={"last_read_at": now}
        )
        return Response({"cleared_at": now})


class TripChatListView(APIView):
    """``GET /api/trip-chats/`` — the user's trip groups for the Messages page."""

    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(responses=TripChatSerializer(many=True))
    def get(self, request):
        user = request.user
        trips = list(
            visible_trips(user)
            .filter(collaborators__isnull=False)
            .select_related("owner__profile")
            .prefetch_related("collaborators__user__profile")
        )
        unread = trip_unread_counts(user)
        last = {}
        newest_per_trip = (
            TripMessage.objects.filter(trip__in=trips)
            .select_related("sender__profile")
            .order_by("trip_id", "-created_at", "-id")
            .distinct("trip_id")
        )
        cleared = dict(
            ChatClear.objects.filter(user=user, trip__in=trips).values_list(
                "trip_id", "cleared_at"
            )
        )
        for m in newest_per_trip:
            if m.trip_id in cleared and m.created_at <= cleared[m.trip_id]:
                continue  # cleared: don't preview a message the thread hides
            last[m.trip_id] = {
                "body": m.body,
                "sender_name": m.sender.profile.display_name,
                "created_at": m.created_at,
            }
        rows = [
            {
                "id": t.pk,
                "title": t.title,
                "members": [t.owner.profile.display_name]
                + [c.user.profile.display_name for c in t.collaborators.all()],
                "unread": unread.get(t.pk, 0),
                "last_message": last.get(t.pk),
            }
            for t in trips
        ]
        # Most recently active first; groups with no messages yet sink.
        rows.sort(
            key=lambda r: r["last_message"]["created_at"].isoformat()
            if r["last_message"]
            else "",
            reverse=True,
        )
        return Response(TripChatSerializer(rows, many=True).data)
