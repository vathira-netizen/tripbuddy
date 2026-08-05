from rest_framework.routers import DefaultRouter

from apps.budgets.views import BudgetItemViewSet

router = DefaultRouter()
router.register("budget-items", BudgetItemViewSet, basename="budget-item")

urlpatterns = router.urls
