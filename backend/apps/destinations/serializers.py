from rest_framework import serializers

from apps.destinations.models import Destination, DestinationReview, SavedDestination


class DestinationSerializer(serializers.ModelSerializer):
    """Public catalogue entry. Exposes the point as plain lat/lng for the map.

    Unlike traveller profiles, a destination's coordinates are public data, so
    they are safe to serialize directly.
    """

    lat = serializers.SerializerMethodField()
    lng = serializers.SerializerMethodField()
    # Populated only by the /nearby/ action (annotated queryset); null otherwise.
    distance_km = serializers.SerializerMethodField()
    # Both come from an .annotate() on the queryset (DestinationViewSet.get_queryset)
    # — one aggregate query total, not one per row.
    avg_rating = serializers.SerializerMethodField()
    review_count = serializers.SerializerMethodField()

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
            "image_urls",
            "distance_km",
            "avg_rating",
            "review_count",
        ]

    def get_lat(self, obj) -> float:
        return obj.point.y

    def get_lng(self, obj) -> float:
        return obj.point.x

    def get_distance_km(self, obj) -> float | None:
        distance = getattr(obj, "distance", None)
        return round(distance.km, 1) if distance is not None else None

    def get_avg_rating(self, obj) -> float | None:
        rating = getattr(obj, "avg_rating", None)
        return round(rating, 1) if rating is not None else None

    def get_review_count(self, obj) -> int:
        return getattr(obj, "review_count", 0) or 0


class DestinationReviewSerializer(serializers.ModelSerializer):
    """A traveller's rating/review — open to anyone onboarded (see models.py).

    Addressed by ``destination`` id on create; a second POST for the same
    (destination, author) pair updates the existing row rather than erroring
    (enforced in the view's perform_create, same upsert shape
    SavedDestinationSerializer.create already uses).
    """

    author_name = serializers.SerializerMethodField()
    author_avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = DestinationReview
        fields = [
            "id",
            "destination",
            "author_name",
            "author_avatar_url",
            "rating",
            "body",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_author_name(self, obj) -> str:
        profile = getattr(obj.author, "profile", None)
        return profile.display_name if profile else ""

    def get_author_avatar_url(self, obj) -> str:
        profile = getattr(obj.author, "profile", None)
        return profile.avatar_url if profile else ""


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
