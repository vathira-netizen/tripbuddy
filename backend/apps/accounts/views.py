from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.geocoding import GeocodingError, geocode_city
from apps.accounts.models import Profile
from apps.accounts.serializers import (
    OnboardingSerializer,
    ProfileSerializer,
    PublicProfileSerializer,
)
from apps.common.permissions import IsSelfProfile


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


class PublicProfileViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only view of other travellers, with no coordinates in the payload.

    Scoped to onboarded profiles; Phase 4 layers the compatibility ranking and
    the blocked/connected exclusions on top of this queryset.
    """

    serializer_class = PublicProfileSerializer
    permission_classes = [IsAuthenticated]
    lookup_field = "supabase_user_id"

    def get_queryset(self):
        return Profile.objects.filter(onboarded=True).exclude(user=self.request.user)
