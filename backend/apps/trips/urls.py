from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.trips.views import (
    ItineraryItemViewSet,
    PublicSharedTripView,
    TripViewSet,
)

router = DefaultRouter()
router.register("trips", TripViewSet, basename="trip")
router.register("itinerary-items", ItineraryItemViewSet, basename="itinerary-item")

urlpatterns = router.urls + [
    path("share/<uuid:token>/", PublicSharedTripView.as_view(), name="shared-trip"),
]
