"""Message payloads and body sanitisation.

On escaping: bodies are stored **exactly as typed** and are never HTML-escaped
here. Escaping is a rendering concern, and the render targets escape already —
React escapes any string it interpolates, and the browser's Realtime path
receives the same raw text through the same components. Escaping on the way in
would instead corrupt the data: a traveller who writes ``5 < 10`` would have
``5 &lt; 10`` stored forever, and a second escape pass downstream would show
``&amp;lt;``.

What *is* rejected on the way in is content that is dangerous regardless of
rendering: control characters that can spoof a UI, and unbounded length.
"""

import re
import unicodedata

from rest_framework import serializers

from apps.messaging.models import Message, TripMessage

# Long enough for a real message, short enough that a single row cannot be used
# to push megabytes through Realtime to the other participant.
MAX_BODY_LENGTH = 2000

# C0/C1 control characters except tab and newline, plus the Unicode
# bidirectional-override characters. The bidi ones matter: they can visually
# reorder text so a message reads differently from what is stored (the
# "Trojan Source" trick).
_CONTROL_CHARS = re.compile(
    r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u200E\u200F\u202A-\u202E\u2066-\u2069]"
)

# Three or more consecutive blank lines collapse to two: enough to keep
# paragraphing, not enough to push a conversation off-screen.
_EXCESS_NEWLINES = re.compile(r"\n{3,}")


def sanitise_body(raw):
    """Normalise and validate a message body, or raise ``ValidationError``."""
    if not isinstance(raw, str):
        raise serializers.ValidationError("Message body must be text.")

    # NFC first: composed and decomposed forms of the same text should not be
    # treated as different lengths.
    body = unicodedata.normalize("NFC", raw)
    body = body.replace("\r\n", "\n").replace("\r", "\n")
    body = _CONTROL_CHARS.sub("", body)
    body = _EXCESS_NEWLINES.sub("\n\n", body)
    body = body.strip()

    if not body:
        raise serializers.ValidationError("Message cannot be empty.")
    if len(body) > MAX_BODY_LENGTH:
        raise serializers.ValidationError(
            f"Message is too long (max {MAX_BODY_LENGTH} characters)."
        )
    return body


class MessageSerializer(serializers.ModelSerializer):
    """A message as returned to either participant."""

    sender = serializers.UUIDField(
        source="sender.profile.supabase_user_id", read_only=True
    )
    sender_name = serializers.CharField(
        source="sender.profile.display_name", read_only=True
    )
    is_mine = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = [
            "id",
            "connection",
            "sender",
            "sender_name",
            "is_mine",
            "body",
            "read_at",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "connection",
            "sender",
            "sender_name",
            "is_mine",
            "read_at",
            "created_at",
        ]

    def get_is_mine(self, obj) -> bool:
        request = self.context.get("request")
        return bool(request and obj.sender_id == request.user.pk)

    def validate_body(self, value):
        return sanitise_body(value)


class TripMessageSerializer(serializers.ModelSerializer):
    """A group-chat message. ``seen_by`` counts the *other* members who have
    read up to it (needs ``reads`` — [(user_id, last_read_at)] — in context)."""

    sender = serializers.UUIDField(
        source="sender.profile.supabase_user_id", read_only=True
    )
    sender_name = serializers.CharField(
        source="sender.profile.display_name", read_only=True
    )
    is_mine = serializers.SerializerMethodField()
    seen_by = serializers.SerializerMethodField()

    class Meta:
        model = TripMessage
        fields = ["id", "trip", "sender", "sender_name", "is_mine", "body",
                  "seen_by", "created_at"]
        read_only_fields = [f for f in fields if f != "body"]

    def get_is_mine(self, obj) -> bool:
        request = self.context.get("request")
        return bool(request and obj.sender_id == request.user.pk)

    def get_seen_by(self, obj) -> int:
        return sum(
            1
            for user_id, read_at in self.context.get("reads", [])
            if user_id != obj.sender_id and read_at >= obj.created_at
        )

    def validate_body(self, value):
        return sanitise_body(value)


class TripChatSerializer(serializers.Serializer):
    """One row of the group list on the Messages page."""

    id = serializers.IntegerField()
    title = serializers.CharField()
    members = serializers.ListField(child=serializers.CharField())
    unread = serializers.IntegerField()
    last_message = serializers.DictField(allow_null=True)


class UnreadSummarySerializer(serializers.Serializer):
    """What the navbar badges need, in one request."""

    unread_messages = serializers.IntegerField()
    pending_requests = serializers.IntegerField()
    unread_by_connection = serializers.DictField(child=serializers.IntegerField())
    unread_by_trip = serializers.DictField(child=serializers.IntegerField())
