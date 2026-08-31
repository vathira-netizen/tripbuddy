from rest_framework import serializers

from apps.accounts.models import Profile
from apps.moderation.models import Report


class ReportSerializer(serializers.ModelSerializer):
    """``POST /api/reports/`` — file a safety report against another traveller.

    Addressed by the target's ``supabase_user_id``, matching
    ``ConnectionCreateSerializer`` — the uuid is the identity the frontend
    already holds, never a Django pk.
    """

    reported_user_id = serializers.UUIDField(write_only=True)

    class Meta:
        model = Report
        fields = ["id", "reported_user_id", "reason", "details", "status", "created_at"]
        read_only_fields = ["id", "status", "created_at"]

    def validate_reported_user_id(self, value):
        profile = (
            Profile.objects.select_related("user")
            .filter(supabase_user_id=value)
            .first()
        )
        if profile is None:
            raise serializers.ValidationError("No such traveller.")
        if profile.user_id == self.context["request"].user.pk:
            raise serializers.ValidationError("You cannot report yourself.")
        self.context["reported_user"] = profile.user
        return value

    def create(self, validated_data):
        validated_data.pop("reported_user_id")
        return Report.objects.create(
            reporter=self.context["request"].user,
            reported_user=self.context["reported_user"],
            **validated_data,
        )
