"""Field validators shared across apps."""

from django.conf import settings
from rest_framework import serializers


def storage_url_prefix() -> str:
    """Where our own uploads live: the public objects in Supabase Storage."""
    base = (settings.SUPABASE_URL or "").rstrip("/")
    return f"{base}/storage/v1/object/public/" if base else ""


def validate_storage_image_url(value: str) -> str:
    """Accept only images uploaded to our Supabase Storage (or nothing).

    Avatars and trip covers are uploaded straight from the browser to Supabase
    Storage, and only the resulting URL is sent here. Without this check anyone
    could PATCH an arbitrary address — a tracking pixel that logs every viewer's
    IP, or an offensive image hosted elsewhere. Pilot seed data sets its
    Unsplash URLs through the ORM, not the API, so it isn't affected.
    """
    value = (value or "").strip()
    if not value:
        return ""
    prefix = storage_url_prefix()
    if not prefix or not value.startswith(prefix):
        raise serializers.ValidationError("Upload the image through TripBuddy.")
    return value


MAX_DB_ID = 2**63 - 1


def parse_id(value, field: str) -> int:
    """A database id taken from raw request input, or a 400 naming the field.

    Filtering on ``"abc"`` directly raises inside the ORM and becomes a 500.
    """
    text = str(value).strip()
    if text.isascii() and text.isdigit() and 0 < int(text) <= MAX_DB_ID:
        return int(text)
    raise serializers.ValidationError({field: "Enter a valid id."})
