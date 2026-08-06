from rest_framework.routers import DefaultRouter

from apps.matching.views import BuddyViewSet

router = DefaultRouter()
router.register("buddies", BuddyViewSet, basename="buddy")

urlpatterns = router.urls
