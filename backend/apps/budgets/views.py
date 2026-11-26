from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from apps.budgets.serializers import BudgetItemSerializer
from apps.common.permissions import IsTripMember
from apps.common.querysets import visible_budget_items
from apps.common.validators import parse_id


class BudgetItemViewSet(viewsets.ModelViewSet):
    """CRUD for a trip's budget line items, scoped to trips you belong to.

    ``category`` is restricted to BudgetItem.Category (Transport, Stay, Food,
    Activities, Other) by the model field's choices, enforced by the
    serializer's validation.
    """

    serializer_class = BudgetItemSerializer
    permission_classes = [IsAuthenticated, IsTripMember]

    def get_queryset(self):
        qs = visible_budget_items(self.request.user).select_related("trip", "payer")
        trip_id = self.request.query_params.get("trip")
        if trip_id:
            qs = qs.filter(trip_id=parse_id(trip_id, "trip"))
        return qs
