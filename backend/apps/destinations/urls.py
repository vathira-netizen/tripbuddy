from rest_framework.routers import DefaultRouter

from apps.destinations.views import (
    DestinationReviewViewSet,
    DestinationViewSet,
    SavedDestinationViewSet,
)

router = DefaultRouter()
router.register("destinations", DestinationViewSet, basename="destination")
router.register("saved-destinations", SavedDestinationViewSet, basename="saved-destination")
router.register("destination-reviews", DestinationReviewViewSet, basename="destination-review")

urlpatterns = router.urls
