"""Buddy-candidate output.

Privacy is the whole design constraint here: this serializer is the boundary
between a candidate's stored ``area_point`` and what another traveller sees. It
therefore builds its payload from an explicit field list and never from the
Profile model's geometry — there is no code path that can serialise a
coordinate, an exact distance, or an email.
"""

from rest_framework import serializers

from apps.accounts.badges import compute_badges
from apps.common.choices import AGE_BAND_ORDER


class ExplanationSerializer(serializers.Serializer):
    """One "why you match" chip."""

    component = serializers.CharField()
    label = serializers.CharField()
    score = serializers.FloatField()
    contribution = serializers.FloatField()


class BuddyCandidateSerializer(serializers.Serializer):
    """A ranked candidate, as returned by ``GET /api/buddies/``.

    Input is one entry from ``apps.matching.services.rank_candidates``.
    """

    supabase_user_id = serializers.UUIDField(source="profile.supabase_user_id")
    display_name = serializers.CharField(source="profile.display_name")
    avatar_url = serializers.CharField(source="profile.avatar_url")
    bio = serializers.CharField(source="profile.bio")
    travel_styles = serializers.ListField(
        source="profile.travel_styles", child=serializers.CharField()
    )
    badges = serializers.SerializerMethodField()
    age_band = serializers.CharField(source="profile.age_band")
    gender = serializers.CharField(source="profile.gender")
    languages = serializers.ListField(
        source="profile.languages", child=serializers.CharField()
    )
    interests = serializers.ListField(
        source="profile.interests", child=serializers.CharField()
    )
    budget_style = serializers.CharField(source="profile.budget_style")
    # The city the traveller typed, e.g. "Bengaluru, Karnataka" — deliberately
    # the only location information in this payload.
    area_label = serializers.CharField(source="profile.area_label")
    # A coarse band, never a measured distance. See services.bucket_distance.
    distance_bucket = serializers.CharField()
    score = serializers.IntegerField()
    explanation = ExplanationSerializer(many=True)

    def get_badges(self, obj) -> list[str]:
        return compute_badges(obj["profile"])


class BuddyFilterSerializer(serializers.Serializer):
    """Validates the ``GET /api/buddies/`` query string.

    Every filter is optional; an unknown value is a 400 rather than a silently
    empty result, so a typo in the UI is visible instead of looking like "no
    travellers near you".
    """

    radius_km = serializers.IntegerField(required=False, min_value=1, max_value=2000)
    gender = serializers.CharField(required=False, allow_blank=True)
    age_band = serializers.ChoiceField(
        choices=[(b, b) for b in AGE_BAND_ORDER], required=False, allow_blank=True
    )
    destination = serializers.IntegerField(required=False, min_value=1)
    # Restricted to verified female travellers — apps.matching.views enforces
    # that, not this serializer, which only validates shape.
    women_only = serializers.BooleanField(required=False, default=False)

    def validate_gender(self, value):
        from apps.accounts.models import Profile

        if not value:
            return ""
        valid = {c[0] for c in Profile._meta.get_field("gender").choices}
        if value not in valid:
            raise serializers.ValidationError(f"'{value}' is not a valid gender.")
        return value
