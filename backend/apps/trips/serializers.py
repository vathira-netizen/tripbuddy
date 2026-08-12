from django.db.models import Q
from rest_framework import serializers

from apps.accounts.models import Profile
from apps.common.permissions import is_trip_member
from apps.common.querysets import accepted_connections
from apps.trips.models import ItineraryItem, Trip, TripCollaborator


class ItineraryItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = ItineraryItem
        fields = [
            "id",
            "trip",
            "day_index",
            "position",
            "title",
            "notes",
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
        return attrs


class CollaboratorSerializer(serializers.ModelSerializer):
    """A trip collaborator, with the safe profile subset used everywhere else."""

    supabase_user_id = serializers.SerializerMethodField()
    display_name = serializers.SerializerMethodField()

    class Meta:
        model = TripCollaborator
        fields = ["id", "supabase_user_id", "display_name", "role", "created_at"]
        read_only_fields = fields

    def get_supabase_user_id(self, obj) -> str | None:
        profile = getattr(obj.user, "profile", None)
        return str(profile.supabase_user_id) if profile else None

    def get_display_name(self, obj) -> str:
        profile = getattr(obj.user, "profile", None)
        return profile.display_name if profile else ""


class TripSerializer(serializers.ModelSerializer):
    nights = serializers.ReadOnlyField()
    collaborators = CollaboratorSerializer(many=True, read_only=True)

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
            "is_public",
            "share_token",
            "collaborators",
            "created_at",
        ]
        # Sharing is toggled through the share/unshare actions, never a plain
        # PATCH — so is_public and the token are read-only on the trip itself.
        read_only_fields = [
            "id",
            "owner",
            "nights",
            "is_public",
            "share_token",
            "collaborators",
            "created_at",
        ]


class ReorderItemSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    day_index = serializers.IntegerField(min_value=0)
    position = serializers.IntegerField(min_value=0)


class ReorderSerializer(serializers.Serializer):
    """Body of POST /api/trips/{id}/reorder/ — the new (day_index, position)."""

    items = ReorderItemSerializer(many=True)


class InviteSerializer(serializers.Serializer):
    """Body of POST /api/trips/{id}/invite/ — an accepted connection to add."""

    supabase_user_id = serializers.UUIDField()

    def validate_supabase_user_id(self, value):
        me = self.context["request"].user
        profile = (
            Profile.objects.select_related("user")
            .filter(supabase_user_id=value)
            .first()
        )
        if profile is None:
            raise serializers.ValidationError("No such traveller.")
        is_connected = (
            accepted_connections(me)
            .filter(Q(requester_id=profile.user_id) | Q(addressee_id=profile.user_id))
            .exists()
        )
        if not is_connected:
            raise serializers.ValidationError(
                "You can only invite travellers you are connected with."
            )
        self.context["target_profile"] = profile
        return value


class PublicItineraryItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = ItineraryItem
        fields = ["day_index", "position", "title", "notes"]
        read_only_fields = fields


class PublicTripSerializer(serializers.ModelSerializer):
    """The read-only view served at /api/share/{token}/ with no auth.

    Deliberately narrow: title, dates, itinerary and the owner's display name —
    no pks, no emails, no coordinates.
    """

    nights = serializers.ReadOnlyField()
    itinerary_items = PublicItineraryItemSerializer(many=True, read_only=True)
    owner_name = serializers.SerializerMethodField()

    class Meta:
        model = Trip
        fields = [
            "title",
            "start_date",
            "end_date",
            "nights",
            "owner_name",
            "itinerary_items",
        ]
        read_only_fields = fields

    def get_owner_name(self, obj) -> str:
        profile = getattr(obj.owner, "profile", None)
        return profile.display_name if profile else ""
