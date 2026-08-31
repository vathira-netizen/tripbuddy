from rest_framework.routers import DefaultRouter

from apps.moderation.views import ReportViewSet

router = DefaultRouter()
router.register("reports", ReportViewSet, basename="report")

urlpatterns = router.urls
