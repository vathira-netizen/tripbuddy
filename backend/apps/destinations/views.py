"""Destination discovery API.

Filtering is done by hand from query params (budget range, region, interest
tags) plus DRF's built-in ``OrderingFilter`` — no django-filter dependency for
what is a dozen lines. All proximity work runs in PostGIS via GeoDjango
(``dwithin`` + ``Distance``); there is deliberately no Python distance math.
"""

from django.contrib.gis.db.models.functions import Distance
from django.contrib.gis.geos import Point
from django.contrib.gis.measure import D
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.filters import OrderingFilter
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.common.permissions import IsOwner
from apps.destinations.models import Destination, SavedDestination
from apps.destinations.serializers import (
    DestinationSerializer,
    SavedDestinationSerializer,
)

MAX_RADIUS_KM = 2000


class DestinationViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Read-only catalogue. Public data, so any authenticated user may read it.

    List supports ?min_budget=&max_budget=&region=&interests=a,b (all optional)
    and ?ordering=avg_daily_budget (or -avg_daily_budget, name).
    """

    serializer_class = DestinationSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [OrderingFilter]
    ordering_fields = ["avg_daily_budget", "name"]
    ordering = ["name"]

    def get_queryset(self):
        qs = Destination.objects.all()
        params = self.request.query_params

        qs = self._apply_int_filter(qs, "avg_daily_budget__gte", params.get("min_budget"))
        qs = self._apply_int_filter(qs, "avg_daily_budget__lte", params.get("max_budget"))

        region = params.get("region")
        if region:
            qs = qs.filter(region__iexact=region)

        interests = params.get("interests")
        if interests:
            tags = [t.strip().lower() for t in interests.split(",") if t.strip()]
            if tags:
                # overlap: destination matches if it has any requested tag.
                qs = qs.filter(interest_tags__overlap=tags)

        return qs

    @staticmethod
    def _apply_int_filter(qs, lookup, raw):
        if raw in (None, ""):
            return qs
        try:
            return qs.filter(**{lookup: int(raw)})
        except ValueError:
            raise ValidationError({lookup.split("__")[0]: "Must be an integer."})

    @action(detail=False, methods=["get"])
    def nearby(self, request):
        """?lat=&lng=&radius_km= — destinations within the radius, nearest first.

        Distance and the radius filter both run in PostGIS; nothing is computed
        in Python.
        """
        try:
            lat = float(request.query_params["lat"])
            lng = float(request.query_params["lng"])
        except (KeyError, ValueError):
            raise ValidationError({"lat/lng": "Numeric lat and lng are required."})

        try:
            radius_km = float(request.query_params.get("radius_km", 500))
        except ValueError:
            raise ValidationError({"radius_km": "Must be a number."})
        radius_km = max(1, min(radius_km, MAX_RADIUS_KM))

        origin = Point(lng, lat, srid=4326)
        qs = (
            self.get_queryset()
            .filter(point__dwithin=(origin, D(km=radius_km)))
            .annotate(distance=Distance("point", origin))
            .order_by("distance")
        )
        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)


class SavedDestinationViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """The requesting user's saved list."""

    serializer_class = SavedDestinationSerializer
    permission_classes = [IsAuthenticated, IsOwner]

    def get_queryset(self):
        return SavedDestination.objects.select_related("destination").filter(
            user=self.request.user
        )
