from rest_framework.routers import DefaultRouter

from apps.accounts.views import ProfileViewSet, PublicProfileViewSet

router = DefaultRouter()
router.register("profile", ProfileViewSet, basename="profile")
router.register("travellers", PublicProfileViewSet, basename="traveller")

urlpatterns = router.urls
