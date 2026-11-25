from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers

from apps.accounts.models import Profile
from apps.budgets.models import BudgetItem
from apps.common.permissions import is_trip_member
from apps.common.querysets import accepted_connections
from apps.common.validators import validate_storage_image_url
from apps.trips.models import (
    ChatMessage,
    Conversation,
    ItineraryItem,
    Trip,
    TripCollaborator,
    TripJoinRequest,
)


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
    is_owner = serializers.SerializerMethodField()
    destination_name = serializers.CharField(source="destination.name", read_only=True, default=None)

    class Meta:
        model = Trip
        fields = [
            "id",
            "owner",
            "title",
            "destination",
            "destination_name",
            "start_date",
            "end_date",
            "target_amount",
            "nights",
            "is_public",
            "share_token",
            "cover_image_url",
            "is_open_to_join",
            "join_deadline",
            "collaborators",
            "is_owner",
            "created_at",
        ]
        # Sharing is toggled through the share/unshare actions, never a plain
        # PATCH — so is_public and the token are read-only on the trip itself.
        # is_open_to_join carries the same public-exposure risk (it opens the
        # trip to join requests from strangers) so it follows the same
        # pattern: read-only here, toggled through the owner-gated
        # open-to-join/close-to-join actions in views.py. cover_image_url has
        # no such risk and stays plain-PATCH writable by any trip member,
        # like title/dates already are.
        read_only_fields = [
            "id",
            "owner",
            "destination_name",
            "nights",
            "is_public",
            "share_token",
            "is_open_to_join",
            "join_deadline",
            "collaborators",
            "is_owner",
            "created_at",
        ]

    def get_is_owner(self, obj) -> bool:
        request = self.context.get("request")
        return bool(request and obj.owner_id == request.user.pk)

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Give the trip a name.")
        return value

    def validate_cover_image_url(self, value):
        return validate_storage_image_url(value)

    def validate(self, attrs):
        # On a PATCH only one date may be sent; check it against the stored one.
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start and end and end < start:
            raise serializers.ValidationError(
                {"end_date": "The trip can't end before it starts."}
            )
        return attrs


class ReorderItemSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    day_index = serializers.IntegerField(min_value=0)
    position = serializers.IntegerField(min_value=0)


class ReorderSerializer(serializers.Serializer):
    """Body of POST /api/trips/{id}/reorder/ — the new (day_index, position)."""

    items = ReorderItemSerializer(many=True)


class OpenToJoinSerializer(serializers.Serializer):
    """Body of POST /api/trips/{id}/open-to-join/ — an optional join deadline."""

    join_deadline = serializers.DateField(required=False, allow_null=True)

    def validate(self, attrs):
        trip = self.context["trip"]
        today = timezone.localdate()
        if trip.start_date and trip.start_date < today:
            raise serializers.ValidationError(
                "This trip has already started, so it can't take join requests."
            )
        deadline = attrs.get("join_deadline")
        if deadline:
            if deadline < today:
                raise serializers.ValidationError(
                    {"join_deadline": "The deadline can't be in the past."}
                )
            if trip.start_date and deadline > trip.start_date:
                raise serializers.ValidationError(
                    {"join_deadline": "The deadline must be on or before the start date."}
                )
        return attrs


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


class OpenTripSerializer(serializers.ModelSerializer):
    """A trip browsed from its destination page by a non-member.

    Deliberately narrow — no budget, share token, or full collaborator list;
    a stranger deciding whether to ask to join sees only who's going and when.
    """

    nights = serializers.ReadOnlyField()
    owner_name = serializers.SerializerMethodField()
    owner_avatar_url = serializers.SerializerMethodField()
    collaborator_count = serializers.IntegerField(source="collaborators.count", read_only=True)
    destination_name = serializers.CharField(
        source="destination.name", read_only=True, default=""
    )
    destination_slug = serializers.CharField(
        source="destination.slug", read_only=True, default=""
    )
    # The effective deadline (falls back to the start date); null = no limit.
    join_deadline = serializers.DateField(
        source="effective_join_deadline", read_only=True, allow_null=True
    )

    class Meta:
        model = Trip
        fields = [
            "id",
            "title",
            "destination_name",
            "destination_slug",
            "start_date",
            "end_date",
            "nights",
            "join_deadline",
            "owner_name",
            "owner_avatar_url",
            "collaborator_count",
        ]
        read_only_fields = fields

    def get_owner_name(self, obj) -> str:
        profile = getattr(obj.owner, "profile", None)
        return profile.display_name if profile else ""

    def get_owner_avatar_url(self, obj) -> str:
        profile = getattr(obj.owner, "profile", None)
        return profile.avatar_url if profile else ""


class TripJoinRequestSerializer(serializers.ModelSerializer):
    """A request to join an ``is_open_to_join`` trip — the trips analogue of
    ``apps.connections.serializers.ConnectionSerializer``.
    """

    requester_name = serializers.SerializerMethodField()
    requester_avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = TripJoinRequest
        fields = [
            "id",
            "trip",
            "requester_name",
            "requester_avatar_url",
            "status",
            "message",
            "created_at",
        ]
        read_only_fields = ["id", "status", "created_at"]

    def get_requester_name(self, obj) -> str:
        profile = getattr(obj.requester, "profile", None)
        return profile.display_name if profile else ""

    def get_requester_avatar_url(self, obj) -> str:
        profile = getattr(obj.requester, "profile", None)
        return profile.avatar_url if profile else ""


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


# --- Phase 6: AI itinerary generation ---------------------------------------


class GenerateParamsSerializer(serializers.Serializer):
    """Body of POST /api/trips/{id}/generate-itinerary/."""

    style = serializers.CharField(required=False, allow_blank=True, default="")
    transport_pref = serializers.CharField(
        required=False, allow_blank=True, default=""
    )
    accommodation_pref = serializers.CharField(
        required=False, allow_blank=True, default=""
    )


class AssistantQuestionSerializer(serializers.Serializer):
    """Body of POST /api/trips/{id}/ask/."""

    question = serializers.CharField(max_length=500)


class ChatMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChatMessage
        fields = ["id", "role", "content", "data", "created_at"]
        read_only_fields = fields


class ConversationListSerializer(serializers.ModelSerializer):
    trip_title = serializers.CharField(source="trip.title", read_only=True, default=None)

    class Meta:
        model = Conversation
        fields = ["id", "title", "trip", "trip_title", "updated_at"]
        read_only_fields = fields


class ConversationSerializer(serializers.ModelSerializer):
    """A conversation with its messages. Only title and trip are writable."""

    trip_title = serializers.CharField(source="trip.title", read_only=True, default=None)
    messages = ChatMessageSerializer(many=True, read_only=True)

    class Meta:
        model = Conversation
        fields = ["id", "title", "trip", "trip_title", "context", "messages", "created_at", "updated_at"]
        read_only_fields = ["id", "context", "messages", "created_at", "updated_at"]

    def validate_trip(self, trip):
        # Only link a trip the user can actually see.
        if trip is not None and not is_trip_member(self.context["request"].user, trip):
            raise serializers.ValidationError("Not a trip you're a member of.")
        return trip


class ChatInputSerializer(serializers.Serializer):
    """Body of POST /api/chats/ and /api/chats/{id}/messages/."""

    message = serializers.CharField(max_length=2000)
    # Only on create: start the chat inside one of your trips.
    trip = serializers.PrimaryKeyRelatedField(
        queryset=Trip.objects.all(), required=False, allow_null=True
    )

    def validate_trip(self, trip):
        if trip is not None and not is_trip_member(self.context["request"].user, trip):
            raise serializers.ValidationError("Not a trip you're a member of.")
        return trip


class DraftItemSerializer(serializers.Serializer):
    """One item of an accepted AI draft, re-validated on the way back in."""

    title = serializers.CharField(max_length=200)
    category = serializers.ChoiceField(
        choices=BudgetItem.Category.values, default=BudgetItem.Category.OTHER
    )
    est_cost = serializers.DecimalField(
        max_digits=10, decimal_places=2, default=0, min_value=0
    )
    location = serializers.CharField(required=False, allow_blank=True, default="")
    notes = serializers.CharField(required=False, allow_blank=True, default="")


class DraftDaySerializer(serializers.Serializer):
    day_index = serializers.IntegerField(min_value=0)
    items = DraftItemSerializer(many=True)


class ApplyItinerarySerializer(serializers.Serializer):
    """Body of POST /api/trips/{id}/apply-itinerary/ — persist an accepted draft."""

    days = DraftDaySerializer(many=True)
    # Also mirror the plan into the Budget Planner as BudgetItems.
    add_to_budget = serializers.BooleanField(default=False)
