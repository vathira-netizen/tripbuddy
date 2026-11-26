from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from apps.accounts.deletion import AccountDeletionError, delete_account
from apps.accounts.geocoding import GeocodingError, geocode_city
from apps.accounts.models import Profile
from apps.accounts.serializers import (
    OnboardingSerializer,
    ProfileSerializer,
    PublicProfileSerializer,
)
from apps.common.permissions import IsSelfProfile
from apps.common.querysets import is_authenticated

DELETE_CONFIRMATION = "DELETE"


class ProfileViewSet(viewsets.GenericViewSet):
    """The requesting user's own profile.

    There is no list route and no lookup by id: a traveller can only ever
    address ``/api/profile/me/``, so there is no pk to guess. Other travellers'
    profiles surface in Phase 4 through the matching API, filtered through
    ``PublicProfileSerializer``.
    """

    serializer_class = ProfileSerializer
    permission_classes = [IsAuthenticated, IsSelfProfile]

    def get_queryset(self):
        return Profile.objects.select_related("user").filter(user=self.request.user)

    def get_object(self):
        profile = self.get_queryset().first()
        if profile is None:
            # The authenticator creates the Profile alongside the User, so this
            # only happens if a Profile was deleted out from under a live token.
            profile = Profile.objects.create(
                user=self.request.user,
                supabase_user_id=self.request.auth["sub"],
            )
        self.check_object_permissions(self.request, profile)
        return profile

    @action(detail=False, methods=["get", "patch", "put"], url_path="me")
    def me(self, request):
        profile = self.get_object()

        if request.method == "GET":
            return Response(self.get_serializer(profile).data)

        serializer = self.get_serializer(
            profile, data=request.data, partial=request.method == "PATCH"
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    @action(detail=False, methods=["post"], url_path="onboarding")
    def onboarding(self, request):
        """Complete (or redo) onboarding: validate, geocode the city, mark done."""

        serializer = OnboardingSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            point, label = geocode_city(data["city"])
        except GeocodingError as exc:
            return Response(
                {"city": [str(exc)]}, status=status.HTTP_422_UNPROCESSABLE_ENTITY
            )

        profile = self.get_object()
        profile.display_name = data["display_name"]
        profile.age_band = data["age_band"]
        profile.gender = data["gender"]
        profile.languages = data["languages"]
        profile.interests = data["interests"]
        profile.budget_style = data["budget_style"]
        profile.daily_budget = data["daily_budget"]
        profile.area_label = label
        profile.area_point = point
        profile.onboarded = True
        profile.save()

        return Response(ProfileSerializer(profile).data, status=status.HTTP_200_OK)

    @extend_schema(request=None, responses={204: None})
    @action(detail=False, methods=["post"], url_path="delete-account")
    def delete_account(self, request):
        """Permanently delete the requesting user's account and all their data.

        The body must be ``{"confirm": "DELETE"}``, so a stray request can't
        wipe an account. See ``apps.accounts.deletion`` for what is removed.
        """
        data = request.data if isinstance(request.data, dict) else {}
        if data.get("confirm") != DELETE_CONFIRMATION:
            return Response(
                {"confirm": [f"Type {DELETE_CONFIRMATION} to confirm."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            delete_account(request.user, request.auth["sub"])
        except AccountDeletionError:
            return Response(
                {"detail": "We couldn't delete your account right now. Please try again later."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


class PublicProfileViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only view of other travellers, with no coordinates in the payload.

    Scoped to onboarded profiles; Phase 4 layers the compatibility ranking and
    the blocked/connected exclusions on top of this queryset.
    """

    serializer_class = PublicProfileSerializer
    permission_classes = [IsAuthenticated]
    lookup_field = "supabase_user_id"

    def get_queryset(self):
        if not is_authenticated(self.request.user):
            return Profile.objects.none()
        return Profile.objects.filter(onboarded=True).exclude(user=self.request.user)


class GeocodeThrottle(UserRateThrottle):
    # Nominatim's usage policy is ~1 request/second for the whole app; the
    # UI only calls this on submit, so a per-user cap just stops abuse.
    rate = "20/min"


class GeocodeView(APIView):
    """``GET /api/geocode/?q=Kochi`` — a typed place, resolved to a rough point.

    Backs Discover's "Travelling from" box. Nothing is stored: the point is
    used only to measure distances, and is rounded to ~1 km like profile areas.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [GeocodeThrottle]

    @extend_schema(
        summary="Look up a city or town",
        parameters=[OpenApiParameter("q", str, required=True)],
        responses=OpenApiTypes.OBJECT,
    )
    def get(self, request):
        query = (request.query_params.get("q") or "").strip()[:120]
        if not query:
            return Response({"detail": "Type a city or town."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            point, label = geocode_city(query)
        except GeocodingError:
            return Response(
                {"detail": f"Couldn't find \"{query}\". Try a nearby city."},
                status=status.HTTP_404_NOT_FOUND,
            )
        # "Kochi, Ernakulam, Kerala, India" -> "Kochi, Kerala": place + state.
        parts = [p.strip() for p in label.split(",") if p.strip()]
        short = ", ".join(parts[:1] + parts[-2:-1]) if len(parts) > 2 else ", ".join(parts)
        return Response({"label": short or query, "lat": point.y, "lng": point.x})
