from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.trips.views import (
    ItineraryItemViewSet,
    PublicSharedTripView,
    TripJoinRequestViewSet,
    TripViewSet,
)

router = DefaultRouter()
router.register("trips", TripViewSet, basename="trip")
router.register("itinerary-items", ItineraryItemViewSet, basename="itinerary-item")
router.register("trip-join-requests", TripJoinRequestViewSet, basename="trip-join-request")

urlpatterns = router.urls + [
    path("share/<uuid:token>/", PublicSharedTripView.as_view(), name="shared-trip"),
]
