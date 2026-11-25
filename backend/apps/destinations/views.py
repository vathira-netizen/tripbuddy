"""Destination discovery API.

Filtering is done by hand from query params (budget range, region, interest
tags) plus DRF's built-in ``OrderingFilter`` — no django-filter dependency for
what is a dozen lines. All proximity work runs in PostGIS via GeoDjango
(``dwithin`` + ``Distance``); there is deliberately no Python distance math.
"""

from django.contrib.gis.db.models.functions import Distance
from django.contrib.gis.geos import Point
from django.contrib.gis.measure import D
from django.db.models import Avg, Count
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.filters import OrderingFilter
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.common.permissions import IsOwner
from apps.common.querysets import is_authenticated
from apps.destinations.models import Destination, DestinationReview, SavedDestination
from apps.destinations.serializers import (
    DestinationReviewSerializer,
    DestinationSerializer,
    SavedDestinationSerializer,
)

MAX_RADIUS_KM = 2000
# ?exclude_near= drops destinations this close to the traveller's starting
# point: travelling from Bengaluru shouldn't suggest Bengaluru. Wide enough to
# cover a big city's own entry, narrow enough to keep day trips (Nandi Hills
# is ~60 km out).
HOME_RADIUS_KM = 40


class DestinationViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Read-only catalogue. Public data, so any authenticated user may read it.

    List supports ?min_budget=&max_budget=&region=&state=&interests=a,b and
    ?exclude_near=lat,lng (all optional) and ?ordering=avg_daily_budget (or
    -avg_daily_budget, name). The nearby action takes the same filters.
    """

    serializer_class = DestinationSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [OrderingFilter]
    ordering_fields = ["avg_daily_budget", "name"]
    ordering = ["name"]
    lookup_field = "slug"

    def get_queryset(self):
        qs = Destination.objects.annotate(
            avg_rating=Avg("reviews__rating"), review_count=Count("reviews", distinct=True)
        )
        params = self.request.query_params

        qs = self._apply_int_filter(qs, "avg_daily_budget__gte", params.get("min_budget"))
        qs = self._apply_int_filter(qs, "avg_daily_budget__lte", params.get("max_budget"))

        region = params.get("region")
        if region:
            qs = qs.filter(region__iexact=region)

        state = params.get("state")
        if state:
            qs = qs.filter(state__iexact=state)

        interests = params.get("interests")
        if interests:
            tags = [t.strip().lower() for t in interests.split(",") if t.strip()]
            if tags:
                # overlap: destination matches if it has any requested tag.
                qs = qs.filter(interest_tags__overlap=tags)

        exclude_near = params.get("exclude_near")
        if exclude_near:
            try:
                lat, lng = (float(v) for v in exclude_near.split(","))
            except ValueError:
                raise ValidationError({"exclude_near": "Use lat,lng."})
            home = Point(lng, lat, srid=4326)
            qs = qs.exclude(point__dwithin=(home, D(km=HOME_RADIUS_KM)))

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
        if not is_authenticated(self.request.user):
            return SavedDestination.objects.none()
        return SavedDestination.objects.select_related("destination").filter(
            user=self.request.user
        )


class DestinationReviewViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """Reviews for one destination. Pass ``?destination=<id>`` to list them.

    Open to any onboarded user — see DestinationReview's docstring for why
    this isn't gated on a recorded past trip there.
    """

    serializer_class = DestinationReviewSerializer
    permission_classes = [IsAuthenticated]
    throttle_scope = "reviews"  # writes only, see WriteScopedThrottle

    def get_queryset(self):
        qs = DestinationReview.objects.select_related("author__profile")
        destination_id = self.request.query_params.get("destination")
        if destination_id:
            qs = qs.filter(destination_id=destination_id)
        return qs

    def perform_create(self, serializer):
        # A second review from the same author for the same destination edits
        # the first rather than erroring or duplicating — same idea as
        # SavedDestinationSerializer.create's get_or_create.
        DestinationReview.objects.update_or_create(
            destination=serializer.validated_data["destination"],
            author=self.request.user,
            defaults={
                "rating": serializer.validated_data["rating"],
                "body": serializer.validated_data.get("body", ""),
            },
        )
        # Re-point the serializer instance at the row that now exists so the
        # response reflects the upserted state either way.
        serializer.instance = DestinationReview.objects.get(
            destination=serializer.validated_data["destination"], author=self.request.user
        )

    def perform_destroy(self, instance):
        if instance.author_id != self.request.user.pk:
            raise PermissionDenied("You may only remove your own review.")
        instance.delete()
