from rest_framework.routers import DefaultRouter

from apps.trips.views import TripViewSet

router = DefaultRouter()
router.register("trips", TripViewSet, basename="trip")

urlpatterns = router.urls
