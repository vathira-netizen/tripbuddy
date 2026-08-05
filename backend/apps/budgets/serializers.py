from rest_framework import serializers

from apps.budgets.models import BudgetItem
from apps.common.permissions import is_trip_member


class BudgetItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = BudgetItem
        fields = [
            "id",
            "trip",
            "category",
            "label",
            "amount",
            "payer",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs):
        trip = attrs.get("trip", getattr(self.instance, "trip", None))
        user = self.context["request"].user
        if trip is not None and not is_trip_member(user, trip):
            raise serializers.ValidationError(
                {"trip": "You are not a member of this trip."}
            )

        payer = attrs.get("payer", getattr(self.instance, "payer", None))
        if payer is not None and trip is not None and not is_trip_member(payer, trip):
            raise serializers.ValidationError(
                {"payer": "Payer must be a member of the trip."}
            )

        return attrs
