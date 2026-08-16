import csv

from django.http import HttpResponse
from drf_spectacular.utils import extend_schema
from rest_framework import generics, mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from apps.budgets import services
from apps.budgets.models import BudgetItem
from apps.common.permissions import IsTripMember, IsTripOwner
from apps.common.querysets import visible_itinerary_items, visible_trips
from apps.trips import ai_service
from apps.trips.models import ItineraryItem, Trip, TripCollaborator
from apps.trips.serializers import (
    ApplyItinerarySerializer,
    GenerateParamsSerializer,
    InviteSerializer,
    ItineraryItemSerializer,
    PublicTripSerializer,
    ReorderSerializer,
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
    OWNER_ACTIONS = {"destroy", "invite", "share", "unshare"}

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

        return Response(
            {
                "trip_id": trip.id,
                "nights": trip.nights,
                "category_totals": services.category_totals(items),
                "per_day": services.per_day_breakdown(items, trip.nights),
                "per_person": services.per_person_split(items, members),
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
