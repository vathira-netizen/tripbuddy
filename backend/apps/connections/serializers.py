"""Connection request payloads.

A connection is addressed by the *other* traveller's ``supabase_user_id``, never
by a Django pk: the uuid is the identity the frontend already holds from
``/api/travellers/`` and ``/api/buddies/``, and it does not leak how many users
exist.
"""

from rest_framework import serializers

from apps.accounts.badges import compute_badges
from apps.accounts.models import Profile
from apps.connections.models import Connection


class ConnectionParticipantSerializer(serializers.ModelSerializer):
    """The other traveller on a connection — the same safe subset as elsewhere.

    No coordinates and no email, matching ``PublicProfileSerializer``. Unlike
    that serializer, this backs a *list* endpoint, so it skips
    ``past_destinations`` (an extra query per row — N+1 across a list) and
    keeps only the cheap same-row fields plus ``badges``.
    """

    badges = serializers.SerializerMethodField()

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
        ]
        read_only_fields = fields

    def get_badges(self, obj) -> list[str]:
        return compute_badges(obj)


class ConnectionSerializer(serializers.ModelSerializer):
    """A connection as seen by one of its two participants."""

    other = serializers.SerializerMethodField()
    direction = serializers.SerializerMethodField()
    can_act = serializers.SerializerMethodField()

    class Meta:
        model = Connection
        fields = [
            "id",
            "status",
            "other",
            "direction",
            "can_act",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_other(self, obj) -> dict | None:
        other = obj.other_user(self._me())
        profile = getattr(other, "profile", None)
        if profile is None:
            return None
        return ConnectionParticipantSerializer(profile).data

    def get_direction(self, obj) -> str:
        """``outgoing`` if the requesting user sent it, otherwise ``incoming``."""
        return "outgoing" if obj.requester_id == self._me().pk else "incoming"

    def get_can_act(self, obj) -> bool:
        """Whether the requesting user may accept/decline this request.

        Only the addressee of a still-pending request can; the sender cannot
        accept their own.
        """
        return obj.status == Connection.Status.PENDING and obj.addressee_id == self._me().pk

    def _me(self):
        return self.context["request"].user


class ConnectionCreateSerializer(serializers.Serializer):
    """``POST /api/connections/`` — send a buddy request."""

    supabase_user_id = serializers.UUIDField()

    def validate_supabase_user_id(self, value):
        profile = (
            Profile.objects.select_related("user")
            .filter(supabase_user_id=value)
            .first()
        )
        if profile is None:
            raise serializers.ValidationError("No such traveller.")
        if profile.user_id == self.context["request"].user.pk:
            raise serializers.ValidationError("You cannot connect with yourself.")
        self.context["target_profile"] = profile
        return value
