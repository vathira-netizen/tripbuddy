from rest_framework import serializers

from apps.accounts.geocoding import GeocodingError, geocode_city
from apps.accounts.models import Profile
from apps.common.choices import INTEREST_TAGS, LANGUAGES


class TagListField(serializers.ListField):
    """A list of values constrained to a shared vocabulary."""

    def __init__(self, vocabulary, max_items, **kwargs):
        self.vocabulary = set(vocabulary)
        kwargs.setdefault("child", serializers.CharField(max_length=32))
        kwargs.setdefault("allow_empty", True)
        kwargs.setdefault("max_length", max_items)
        super().__init__(**kwargs)

    def to_internal_value(self, data):
        values = super().to_internal_value(data)
        cleaned = []
        for value in values:
            value = value.strip().lower()
            if value not in self.vocabulary:
                raise serializers.ValidationError(f"'{value}' is not a valid choice.")
            if value not in cleaned:
                cleaned.append(value)
        return cleaned


class ProfileSerializer(serializers.ModelSerializer):
    """The owner's own profile. Includes the approximate point as lat/lng.

    Only ever returned to the profile's owner — see ``PublicProfileSerializer``
    for what other travellers are allowed to see.
    """

    email = serializers.EmailField(source="user.email", read_only=True)
    languages = TagListField(LANGUAGES, max_items=8, required=False)
    interests = TagListField(INTEREST_TAGS, max_items=10, required=False)
    area = serializers.SerializerMethodField()
    # Write-only: send a city name to move your approximate area. It is
    # geocoded server-side and only the rounded point is stored — the client
    # never sends or receives coordinates it could pinpoint someone with.
    city = serializers.CharField(
        max_length=120, write_only=True, required=False, allow_blank=True
    )

    class Meta:
        model = Profile
        fields = [
            "supabase_user_id",
            "email",
            "display_name",
            "age_band",
            "gender",
            "languages",
            "interests",
            "budget_style",
            "daily_budget",
            "area_label",
            "area",
            "city",
            "onboarded",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "supabase_user_id",
            "email",
            "area_label",
            "area",
            "onboarded",
            "created_at",
            "updated_at",
        ]

    def get_area(self, obj) -> dict[str, float] | None:
        """The user's own approximate point, rounded at storage time."""
        if obj.area_point is None:
            return None
        return {"lat": obj.area_point.y, "lng": obj.area_point.x}

    def validate_daily_budget(self, value):
        if value is not None and value > 1_000_000:
            raise serializers.ValidationError("Daily budget looks unrealistic.")
        return value

    def update(self, instance, validated_data):
        city = validated_data.pop("city", "").strip()
        if city:
            try:
                point, label = geocode_city(city)
            except GeocodingError as exc:
                raise serializers.ValidationError({"city": [str(exc)]})
            instance.area_point = point
            instance.area_label = label
        return super().update(instance, validated_data)


class PublicProfileSerializer(serializers.ModelSerializer):
    """What *other* travellers may see.

    Deliberately has no coordinate field of any kind. Phase 4 adds a coarse
    distance bucket computed in PostGIS; raw coordinates never leave the backend.
    """

    class Meta:
        model = Profile
        fields = [
            "supabase_user_id",
            "display_name",
            "age_band",
            "gender",
            "languages",
            "interests",
            "budget_style",
            "area_label",
        ]
        read_only_fields = fields


class OnboardingSerializer(serializers.Serializer):
    """Everything the onboarding stepper submits, in one request.

    ``city`` is free text; the view geocodes it and stores only the rounded
    point. The client never sends coordinates.
    """

    display_name = serializers.CharField(max_length=60)
    age_band = serializers.ChoiceField(choices=Profile._meta.get_field("age_band").choices)
    gender = serializers.ChoiceField(choices=Profile._meta.get_field("gender").choices)
    languages = TagListField(LANGUAGES, max_items=8, allow_empty=False)
    interests = TagListField(INTEREST_TAGS, max_items=10, allow_empty=False)
    budget_style = serializers.ChoiceField(
        choices=Profile._meta.get_field("budget_style").choices
    )
    daily_budget = serializers.IntegerField(min_value=0, max_value=1_000_000)
    city = serializers.CharField(max_length=120)
