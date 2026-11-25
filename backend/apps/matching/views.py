"""``GET /api/buddies/`` — ranked travel-buddy candidates."""

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.common.permissions import RequiresVerifiedPhone
from apps.matching import services
from apps.matching.constants import default_radius_km
from apps.matching.serializers import BuddyCandidateSerializer, BuddyFilterSerializer


class BuddyViewSet(viewsets.ViewSet):
    """Compatible travellers near the requesting user, best match first.

    Ranking is a transparent weighted sum computed in Python — see
    ``apps.matching.compatibility`` — over candidates that PostGIS has already
    narrowed to the search radius.
    """

    # Searching for buddies needs a confirmed phone number.
    permission_classes = [IsAuthenticated, RequiresVerifiedPhone]

    @extend_schema(
        summary="Ranked travel-buddy candidates",
        parameters=[
            OpenApiParameter(
                "radius_km",
                int,
                description="Search radius in km (1-2000). Defaults to the "
                            "configured MATCH_DEFAULT_RADIUS_KM.",
            ),
            OpenApiParameter("gender", str, description="Exact gender match."),
            OpenApiParameter("age_band", str, description="Exact age-band match."),
            OpenApiParameter(
                "destination",
                int,
                description="Destination id — only travellers who saved it.",
            ),
            OpenApiParameter(
                "women_only",
                bool,
                description="Only female candidates. Restricted to requesters "
                            "who are themselves a verified female profile.",
            ),
        ],
        responses=BuddyCandidateSerializer(many=True),
    )
    def list(self, request):
        filters = BuddyFilterSerializer(data=request.query_params)
        filters.is_valid(raise_exception=True)
        data = filters.validated_data

        profile = getattr(request.user, "profile", None)
        if profile is None or profile.area_point is None:
            # Not an error: the user simply has not told us where they are, so
            # there is no origin to search from. Say that explicitly rather than
            # return an empty list that reads as "nobody is nearby".
            return Response(
                {
                    "detail": "Set your city in your profile to find travellers near you.",
                    "code": "no_area",
                    "results": [],
                },
                status=status.HTTP_409_CONFLICT,
            )

        gender = data.get("gender") or None
        if data.get("women_only"):
            if not (profile.gender == "female" and profile.email_verified):
                raise PermissionDenied(
                    "Women-only matching is available to verified female profiles."
                )
            gender = "female"

        ranked = services.rank_candidates(
            request.user,
            radius_km=data.get("radius_km"),
            gender=gender,
            age_band=data.get("age_band") or None,
            destination_id=data.get("destination"),
        )
        serializer = BuddyCandidateSerializer(ranked, many=True)
        return Response(
            {
                "radius_km": data.get("radius_km") or default_radius_km(),
                "count": len(ranked),
                "results": serializer.data,
            }
        )
