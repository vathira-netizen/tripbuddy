from rest_framework import serializers

from apps.trips.models import Trip


class TripSerializer(serializers.ModelSerializer):
    nights = serializers.ReadOnlyField()

    class Meta:
        model = Trip
        fields = [
            "id",
            "owner",
            "title",
            "destination",
            "start_date",
            "end_date",
            "target_amount",
            "nights",
            "created_at",
        ]
        read_only_fields = ["id", "owner", "nights", "created_at"]
