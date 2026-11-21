from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.accounts.views import GeocodeView, ProfileViewSet, PublicProfileViewSet

router = DefaultRouter()
router.register("profile", ProfileViewSet, basename="profile")
router.register("travellers", PublicProfileViewSet, basename="traveller")

urlpatterns = router.urls + [
    path("geocode/", GeocodeView.as_view(), name="geocode"),
]
