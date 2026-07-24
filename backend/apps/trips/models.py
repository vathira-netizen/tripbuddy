import uuid

from django.conf import settings
from django.db import models


class Trip(models.Model):
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="trips"
    )
    title = models.CharField(max_length=120)
    destination = models.ForeignKey(
        "destinations.Destination",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="trips",
    )
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)

    # Read-only public sharing (Phase 5). Kept here so the schema is frozen now.
    share_token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    is_public = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-start_date", "-created_at"]

    def __str__(self):
        return self.title

    @property
    def nights(self):
        if not (self.start_date and self.end_date):
            return 0
        return max((self.end_date - self.start_date).days, 0)


class TripCollaborator(models.Model):
    class Role(models.TextChoices):
        OWNER = "owner", "Owner"
        EDITOR = "editor", "Editor"
        VIEWER = "viewer", "Viewer"

    trip = models.ForeignKey(
        Trip, on_delete=models.CASCADE, related_name="collaborators"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="trip_collaborations",
    )
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.EDITOR)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("trip", "user")]
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.user_id} on {self.trip_id} ({self.role})"


class ItineraryItem(models.Model):
    trip = models.ForeignKey(
        Trip, on_delete=models.CASCADE, related_name="itinerary_items"
    )
    # 0-based offset from the trip's start_date.
    day_index = models.PositiveIntegerField(default=0)
    # Order within the day; the Phase 5 reorder endpoint rewrites these.
    position = models.PositiveIntegerField(default=0)
    title = models.CharField(max_length=200)
    notes = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["day_index", "position", "id"]
        indexes = [
            models.Index(fields=["trip", "day_index", "position"]),
        ]

    def __str__(self):
        return f"D{self.day_index}: {self.title}"
