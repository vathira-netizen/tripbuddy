import csv

from django.db.models import Q
from django.http import HttpResponse
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics, mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import Profile
from apps.budgets import services
from apps.budgets.models import BudgetItem
from apps.common.permissions import IsTripMember, IsTripOwner, is_trip_member
from apps.common.querysets import visible_itinerary_items, visible_trips
from apps.trips import ai_service
from apps.trips.llm import ItineraryParseError
from apps.trips.models import ItineraryItem, Trip, TripCollaborator, TripJoinRequest
from apps.trips.serializers import (
    ApplyItinerarySerializer,
    AssistantQuestionSerializer,
    GenerateParamsSerializer,
    InviteSerializer,
    ItineraryItemSerializer,
    OpenTripSerializer,
    PublicTripSerializer,
    ReorderSerializer,
    TripJoinRequestSerializer,
    TripSerializer,
)


class TripViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """Trips you own or collaborate on: CRUD, plus reorder / invite / share.

    Owner + collaborators may read and write the trip and its itinerary; only
    the owner may delete it, invite collaborators, or toggle public sharing.
    """

    serializer_class = TripSerializer
    permission_classes = [IsAuthenticated, IsTripMember]

    # Owner-only actions. Everything else is open to any trip member.
    OWNER_ACTIONS = {"destroy", "invite", "share", "unshare", "open_to_join", "close_to_join"}

    def get_permissions(self):
        if self.action in self.OWNER_ACTIONS:
            return [IsAuthenticated(), IsTripOwner()]
        return super().get_permissions()

    def get_queryset(self):
        return (
            visible_trips(self.request.user)
            .select_related("owner", "destination")
            .prefetch_related("collaborators__user__profile")
        )

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    @extend_schema(
        summary="Reorder itinerary items",
        request=ReorderSerializer,
        responses={200: ItineraryItemSerializer(many=True)},
    )
    @action(detail=True, methods=["post"])
    def reorder(self, request, pk=None):
        """Persist a new (day_index, position) for a set of the trip's items."""
        trip = self.get_object()
        serializer = ReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        rows = serializer.validated_data["items"]

        ids = [row["id"] for row in rows]
        owned = {
            item.id: item
            for item in ItineraryItem.objects.filter(trip=trip, id__in=ids)
        }
        if set(ids) != set(owned):
            raise ValidationError({"items": "Every item must belong to this trip."})

        for row in rows:
            item = owned[row["id"]]
            item.day_index = row["day_index"]
            item.position = row["position"]
        # ponytail: last-write-wins bulk_update, no row locks. Two simultaneous
        # reorders can interleave; add per-trip locking only if that shows up.
        ItineraryItem.objects.bulk_update(owned.values(), ["day_index", "position"])

        return Response(
            ItineraryItemSerializer(
                trip.itinerary_items.all(), many=True, context={"request": request}
            ).data
        )

    @extend_schema(
        summary="Invite an accepted connection as a collaborator",
        request=InviteSerializer,
        responses={200: TripSerializer, 201: TripSerializer},
    )
    @action(detail=True, methods=["post"])
    def invite(self, request, pk=None):
        trip = self.get_object()
        serializer = InviteSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        target = serializer.context["target_profile"]

        _, created = TripCollaborator.objects.get_or_create(
            trip=trip,
            user=target.user,
            defaults={"role": TripCollaborator.Role.EDITOR},
        )
        return Response(
            TripSerializer(trip, context={"request": request}).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    @extend_schema(summary="Publish a read-only share link", request=None,
                   responses={200: TripSerializer})
    @action(detail=True, methods=["post"])
    def share(self, request, pk=None):
        return self._set_public(True)

    @extend_schema(summary="Revoke the share link", request=None,
                   responses={200: TripSerializer})
    @action(detail=True, methods=["post"])
    def unshare(self, request, pk=None):
        return self._set_public(False)

    def _set_public(self, is_public):
        trip = self.get_object()
        trip.is_public = is_public
        trip.save(update_fields=["is_public", "updated_at"])
        return Response(
            TripSerializer(trip, context={"request": self.request}).data
        )

    @extend_schema(
        summary="Open this trip to join requests from any traveller",
        request=None, responses={200: TripSerializer},
    )
    @action(detail=True, methods=["post"], url_path="open-to-join")
    def open_to_join(self, request, pk=None):
        return self._set_open_to_join(True)

    @extend_schema(
        summary="Stop accepting join requests", request=None,
        responses={200: TripSerializer},
    )
    @action(detail=True, methods=["post"], url_path="close-to-join")
    def close_to_join(self, request, pk=None):
        return self._set_open_to_join(False)

    def _set_open_to_join(self, is_open):
        trip = self.get_object()
        trip.is_open_to_join = is_open
        trip.save(update_fields=["is_open_to_join", "updated_at"])
        return Response(
            TripSerializer(trip, context={"request": self.request}).data
        )

    @extend_schema(
        summary="Trips open to join, optionally filtered by destination",
        description="Browsable by any authenticated user, not just members — "
                    "this is how a stranger on a destination page finds a "
                    "trip to ask to join. Returns the narrow OpenTripSerializer "
                    "shape, never budget/share/collaborator details.",
        parameters=[OpenApiParameter("destination", int, required=False)],
        responses=OpenTripSerializer(many=True),
    )
    @action(detail=False, methods=["get"], url_path="open")
    def open_trips(self, request):
        today = timezone.now().date()
        qs = (
            Trip.objects.filter(is_open_to_join=True)
            .filter(Q(end_date__isnull=True) | Q(end_date__gte=today))
            .select_related("owner__profile")
        )
        destination_id = request.query_params.get("destination")
        if destination_id:
            qs = qs.filter(destination_id=destination_id)
        serializer = OpenTripSerializer(qs, many=True)
        return Response(serializer.data)

    @extend_schema(
        summary="Draft an itinerary with the AI generator (not persisted)",
        request=GenerateParamsSerializer,
    )
    @action(detail=True, methods=["post"], url_path="generate-itinerary")
    def generate_itinerary(self, request, pk=None):
        """Owner/collaborators only. Returns a budget-validated DRAFT.

        The model's costs are re-summed against the trip budget in
        apps.trips.ai_service — an over-budget plan is flagged, never hidden.
        """
        trip = self.get_object()
        params = GenerateParamsSerializer(data=request.data)
        params.is_valid(raise_exception=True)
        try:
            draft = ai_service.generate_itinerary(trip, params.validated_data)
        except ai_service.LLMConfigError:
            return Response(
                {"detail": "AI itinerary generation is not configured on the server."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except ai_service.LLMError:
            return Response(
                {"detail": "The AI service is unavailable right now. Try again."},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        return Response(draft)

    @extend_schema(
        summary="Ask the trip assistant a question about this trip and budget",
        request=AssistantQuestionSerializer,
    )
    @action(detail=True, methods=["post"], url_path="ask")
    def ask(self, request, pk=None):
        """Owner/collaborators only. Any plan in the reply is budget-checked."""
        trip = self.get_object()
        body = AssistantQuestionSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            reply = ai_service.ask_assistant(trip, body.validated_data["question"])
        except ai_service.LLMConfigError:
            return Response(
                {"detail": "The assistant is not configured on the server."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except (ai_service.LLMError, ItineraryParseError):
            return Response(
                {"detail": "The assistant is unavailable right now. Try again."},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        return Response(reply)

    @extend_schema(
        summary="Persist an accepted AI draft as itinerary items",
        request=ApplyItinerarySerializer,
        responses={201: ItineraryItemSerializer(many=True)},
    )
    @action(detail=True, methods=["post"], url_path="apply-itinerary")
    def apply_itinerary(self, request, pk=None):
        """Owner/collaborators only. Appends the draft's items to the board."""
        trip = self.get_object()
        serializer = ApplyItinerarySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        days = serializer.validated_data["days"]
        add_to_budget = serializer.validated_data["add_to_budget"]

        # Append after whatever already sits in each day.
        next_position: dict[int, int] = {}
        for row in trip.itinerary_items.values("day_index", "position"):
            day = row["day_index"]
            next_position[day] = max(next_position.get(day, -1), row["position"])

        new_items, new_budget_items = [], []
        for day in days:
            day_index = day["day_index"]
            for item in day["items"]:
                position = next_position.get(day_index, -1) + 1
                next_position[day_index] = position
                new_items.append(
                    ItineraryItem(
                        trip=trip,
                        day_index=day_index,
                        position=position,
                        title=item["title"],
                        notes=item.get("notes", ""),
                    )
                )
                if add_to_budget and item["est_cost"]:
                    new_budget_items.append(
                        BudgetItem(
                            trip=trip,
                            category=item["category"],
                            label=item["title"],
                            amount=item["est_cost"],
                        )
                    )

        created = ItineraryItem.objects.bulk_create(new_items)
        if new_budget_items:
            BudgetItem.objects.bulk_create(new_budget_items)

        return Response(
            ItineraryItemSerializer(
                created, many=True, context={"request": request}
            ).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["get"], url_path="budget-summary")
    def budget_summary(self, request, pk=None):
        """Category/day/person breakdown plus running total vs target_amount.

        All the actual math lives in apps.budgets.services — this just
        gathers the trip's items, nights, and member list to feed it.
        """
        trip = self.get_object()
        items = list(trip.budget_items.all())
        members = [trip.owner_id, *trip.collaborators.values_list("user_id", flat=True)]

        # Real names/avatars for the per-person split — kept out of
        # apps.budgets.services, which is deliberately ORM-free (see its
        # docstring); the view is the seam that bridges a real queryset in.
        # upi_vpa is included so a member who's owed money can be paid via the
        # Settle Up flow — scoped to fellow trip members only, never public.
        profiles = Profile.objects.filter(user_id__in=members).values(
            "user_id", "display_name", "avatar_url", "upi_vpa"
        )
        member_info = {
            str(p["user_id"]): {
                "display_name": p["display_name"],
                "avatar_url": p["avatar_url"],
                "upi_vpa": p["upi_vpa"],
                "is_owner": p["user_id"] == trip.owner_id,
                "is_me": p["user_id"] == request.user.pk,
            }
            for p in profiles
        }

        per_person = services.per_person_split(items, members)

        return Response(
            {
                "trip_id": trip.id,
                "nights": trip.nights,
                "category_totals": services.category_totals(items),
                "per_day": services.per_day_breakdown(items, trip.nights),
                "per_person": per_person,
                "settlements": services.simplify_debts(per_person["per_member"]),
                "members": member_info,
                "running_total": services.running_total_vs_target(
                    items, trip.target_amount
                ),
            }
        )

    @action(detail=True, methods=["get"], url_path="budget.csv")
    def budget_csv(self, request, pk=None):
        """The trip's budget items as a CSV download."""
        trip = self.get_object()

        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = (
            f'attachment; filename="trip-{trip.id}-budget.csv"'
        )

        writer = csv.writer(response)
        writer.writerow(["category", "label", "amount", "payer_email", "created_at"])
        for item in trip.budget_items.select_related("payer").all():
            writer.writerow(
                [
                    item.category,
                    item.label,
                    item.amount,
                    item.payer.email if item.payer else "",
                    item.created_at.isoformat(),
                ]
            )
        return response


class ItineraryItemViewSet(viewsets.ModelViewSet):
    """CRUD for a trip's day-wise itinerary items, scoped to trips you belong to.

    Pass ``?trip=<id>`` to list one trip's items; the board calls this on load.
    """

    serializer_class = ItineraryItemSerializer
    permission_classes = [IsAuthenticated, IsTripMember]

    def get_queryset(self):
        qs = visible_itinerary_items(self.request.user).select_related("trip")
        trip_id = self.request.query_params.get("trip")
        if trip_id:
            qs = qs.filter(trip_id=trip_id)
        return qs


class TripJoinRequestViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """Ask to join an ``is_open_to_join`` trip; the owner accepts/declines.

    Mirrors apps.connections.views.ConnectionViewSet's shape: visible to
    either side (the requester, to see their own status; the trip owner, to
    review requests), create resolves the trip from the body rather than the
    URL, accept/decline are owner-only detail actions.
    """

    serializer_class = TripJoinRequestSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return TripJoinRequest.objects.filter(
            Q(requester=user) | Q(trip__owner=user)
        ).select_related("trip", "requester__profile")

    @extend_schema(
        summary="Ask to join a trip",
        description="The trip must have is_open_to_join=True. 409s (with the "
                    "existing request) on a duplicate ask, matching how "
                    "apps.connections handles a repeat connection request.",
    )
    def create(self, request, *args, **kwargs):
        trip_id = request.data.get("trip")
        trip = Trip.objects.filter(pk=trip_id, is_open_to_join=True).first()
        if trip is None:
            raise ValidationError({"trip": "No open-to-join trip with that id."})
        if is_trip_member(request.user, trip):
            raise ValidationError({"trip": "You're already on this trip."})

        existing = TripJoinRequest.objects.filter(trip=trip, requester=request.user).first()
        if existing is not None:
            return Response(
                self.get_serializer(existing).data, status=status.HTTP_409_CONFLICT
            )

        serializer = self.get_serializer(
            data={**request.data, "trip": trip.id}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save(trip=trip, requester=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @extend_schema(summary="Accept a join request", request=None,
                   responses={200: TripJoinRequestSerializer})
    @action(detail=True, methods=["post"])
    def accept(self, request, pk=None):
        return self._respond(status_value=TripJoinRequest.Status.ACCEPTED)

    @extend_schema(summary="Decline a join request", request=None,
                   responses={200: TripJoinRequestSerializer})
    @action(detail=True, methods=["post"])
    def decline(self, request, pk=None):
        return self._respond(status_value=TripJoinRequest.Status.DECLINED)

    def _respond(self, status_value):
        join_request = self.get_object()
        if join_request.trip.owner_id != self.request.user.pk:
            raise PermissionDenied("Only the trip owner may answer this request.")
        if join_request.status != TripJoinRequest.Status.PENDING:
            raise ValidationError(
                {"status": f"This request is already {join_request.status}."}
            )

        join_request.status = status_value
        join_request.save(update_fields=["status", "updated_at"])

        if status_value == TripJoinRequest.Status.ACCEPTED:
            TripCollaborator.objects.get_or_create(
                trip=join_request.trip,
                user=join_request.requester,
                defaults={"role": TripCollaborator.Role.EDITOR},
            )

        return Response(self.get_serializer(join_request).data)


class PublicSharedTripView(generics.RetrieveAPIView):
    """GET /api/share/{token}/ — a public trip's itinerary, no auth required.

    Only trips with is_public=True are reachable; revoking sharing drops the
    row from the queryset, so the link 404s.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    serializer_class = PublicTripSerializer
    lookup_field = "share_token"
    lookup_url_kwarg = "token"

    def get_queryset(self):
        return Trip.objects.filter(is_public=True).select_related(
            "owner__profile"
        ).prefetch_related("itinerary_items")
