from rest_framework import serializers

from apps.budgets.models import BudgetItem
from apps.common.permissions import is_trip_member, require_trip_editor


# Per line item; generous for a group trip, but catches a slipped extra zero.
MAX_AMOUNT = 1_000_000


class BudgetItemSerializer(serializers.ModelSerializer):
    payer_name = serializers.SerializerMethodField()
    payer_avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = BudgetItem
        fields = [
            "id",
            "trip",
            "category",
            "label",
            "amount",
            "payer",
            "payer_name",
            "payer_avatar_url",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "payer_name", "payer_avatar_url", "created_at", "updated_at"]

    def get_payer_name(self, obj) -> str | None:
        profile = getattr(obj.payer, "profile", None)
        return profile.display_name if profile else None

    def get_payer_avatar_url(self, obj) -> str | None:
        profile = getattr(obj.payer, "profile", None)
        return profile.avatar_url if profile else None

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Enter an amount above ₹0.")
        if value > MAX_AMOUNT:
            raise serializers.ValidationError("That's more than ₹10,00,000 — check the amount.")
        return value

    def validate_label(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Say what this was for.")
        return value

    def validate(self, attrs):
        trip = attrs.get("trip", getattr(self.instance, "trip", None))
        user = self.context["request"].user
        if trip is not None:
            if not is_trip_member(user, trip):
                raise serializers.ValidationError(
                    {"trip": "You are not a member of this trip."}
                )
            require_trip_editor(user, trip)

        payer = attrs.get("payer", getattr(self.instance, "payer", None))
        if payer is not None and trip is not None and not is_trip_member(payer, trip):
            raise serializers.ValidationError(
                {"payer": "Payer must be a member of the trip."}
            )

        return attrs
