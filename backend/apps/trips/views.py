import csv

from django.http import HttpResponse
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.budgets import services
from apps.common.permissions import IsTripMember
from apps.common.querysets import visible_trips
from apps.trips.serializers import TripSerializer


class TripViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """Minimal trip API: create your own trips, list/retrieve the ones you're on.

    Just enough for a budget item to have a trip to attach to; itinerary,
    collaborators, and sharing are later phases.
    """

    serializer_class = TripSerializer
    permission_classes = [IsAuthenticated, IsTripMember]

    def get_queryset(self):
        return visible_trips(self.request.user)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

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
