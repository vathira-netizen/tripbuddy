from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers

from apps.common.validators import validate_storage_image_url
from apps.accounts.badges import compute_badges
from apps.accounts.geocoding import GeocodingError, geocode_city
from apps.accounts.models import Profile
from apps.common.choices import INTEREST_TAGS, LANGUAGES, TRAVEL_STYLES
from apps.destinations.models import Destination


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
    travel_styles = TagListField(TRAVEL_STYLES, max_items=len(TRAVEL_STYLES), required=False)
    area = serializers.SerializerMethodField()
    completeness = serializers.SerializerMethodField()
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
            "avatar_url",
            "bio",
            "travel_styles",
            "upi_vpa",
            "email_verified",
            "completeness",
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
            "email_verified",
            "completeness",
            "supabase_user_id",
            "email",
            "area_label",
            "area",
            "onboarded",
            "created_at",
            "updated_at",
        ]

    # (field_name, human label) — order doubles as priority for `missing`, and
    # matches the enrichment fields the profile modal/badges care about. The
    # always-required onboarding fields (name/age/gender/budget style) aren't
    # counted: an onboarded profile already has them.
    COMPLETENESS_CHECKLIST = [
        ("avatar_url", "a profile photo"),
        ("bio", "a bio"),
        ("travel_styles", "your travel style"),
        ("languages", "languages you speak"),
        ("interests", "travel interests"),
        ("daily_budget", "a daily budget"),
        ("upi_vpa", "a UPI ID for settling up"),
    ]

    def get_completeness(self, obj) -> dict:
        missing = [
            label
            for field, label in self.COMPLETENESS_CHECKLIST
            if not getattr(obj, field)
        ]
        total = len(self.COMPLETENESS_CHECKLIST)
        filled = total - len(missing)
        return {"percent": round(filled / total * 100), "missing": missing}

    def get_area(self, obj) -> dict[str, float] | None:
        """The user's own approximate point, rounded at storage time."""
        if obj.area_point is None:
            return None
        return {"lat": obj.area_point.y, "lng": obj.area_point.x}

    def validate_daily_budget(self, value):
        if value is not None and value > 1_000_000:
            raise serializers.ValidationError("Daily budget looks unrealistic.")
        return value

    def validate_avatar_url(self, value):
        return validate_storage_image_url(value)

    def validate_upi_vpa(self, value):
        value = value.strip()
        if not value:
            return value
        # Deliberately loose — a VPA is "handle@psp", but the exact charset
        # varies by bank/PSP. Just enough to catch a pasted phone number or
        # stray whitespace, not a false rejection of a real VPA.
        if " " in value or value.count("@") != 1 or value.startswith("@") or value.endswith("@"):
            raise serializers.ValidationError("Enter a valid UPI ID, e.g. name@bank.")
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

    This is also the payload for ``GET /api/travellers/<supabase_user_id>/`` — a
    single-object retrieve — so unlike the leaner participant/candidate shapes
    used in list views (``ConnectionParticipantSerializer``,
    ``BuddyCandidateSerializer``), it can afford the heavier ``past_destinations``
    lookup without an N+1 risk.
    """

    badges = serializers.SerializerMethodField()
    past_destinations = serializers.SerializerMethodField()

    class Meta:
        model = Profile
        fields = [
            "supabase_user_id",
            "display_name",
            "avatar_url",
            "bio",
            "travel_styles",
            "badges",
            "age_band",
            "gender",
            "languages",
            "interests",
            "budget_style",
            "area_label",
            "past_destinations",
        ]
        read_only_fields = fields

    def get_badges(self, obj) -> list[str]:
        return compute_badges(obj)

    def get_past_destinations(self, obj) -> list[dict]:
        from apps.trips.models import Trip

        destination_ids = (
            Trip.objects.filter(
                Q(owner=obj.user) | Q(collaborators__user=obj.user),
                end_date__lt=timezone.now().date(),
                destination__isnull=False,
            )
            .values_list("destination_id", flat=True)
            .distinct()
        )
        destinations = Destination.objects.filter(id__in=destination_ids)
        return [
            {"id": d.id, "name": d.name, "slug": d.slug, "image_url": d.image_url}
            for d in destinations
        ]


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
