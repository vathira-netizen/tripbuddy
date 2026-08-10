from rest_framework import serializers

from apps.destinations.models import Destination, SavedDestination


class DestinationSerializer(serializers.ModelSerializer):
    """Public catalogue entry. Exposes the point as plain lat/lng for the map.

    Unlike traveller profiles, a destination's coordinates are public data, so
    they are safe to serialize directly.
    """

    lat = serializers.SerializerMethodField()
    lng = serializers.SerializerMethodField()
    # Populated only by the /nearby/ action (annotated queryset); null otherwise.
    distance_km = serializers.SerializerMethodField()

    class Meta:
        model = Destination
        fields = [
            "id",
            "name",
            "slug",
            "lat",
            "lng",
            "avg_daily_budget",
            "budget_tier",
            "interest_tags",
            "best_season",
            "region",
            "image_url",
            "distance_km",
        ]

    def get_lat(self, obj) -> float:
        return obj.point.y

    def get_lng(self, obj) -> float:
        return obj.point.x

    def get_distance_km(self, obj) -> float | None:
        distance = getattr(obj, "distance", None)
        return round(distance.km, 1) if distance is not None else None


class SavedDestinationSerializer(serializers.ModelSerializer):
    destination = DestinationSerializer(read_only=True)
    destination_id = serializers.PrimaryKeyRelatedField(
        source="destination", queryset=Destination.objects.all(), write_only=True
    )

    class Meta:
        model = SavedDestination
        fields = ["id", "destination", "destination_id", "created_at"]
        read_only_fields = ["id", "created_at"]

    def create(self, validated_data):
        # Saving the same destination twice is a no-op, not an error.
        saved, _ = SavedDestination.objects.get_or_create(
            user=self.context["request"].user,
            destination=validated_data["destination"],
        )
        return saved
