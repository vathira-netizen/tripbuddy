from django.conf import settings
from django.contrib.gis.db import models as gis_models
from django.contrib.postgres.fields import ArrayField
from django.db import models

from apps.common.choices import BudgetTier


class Destination(models.Model):
    """A curated catalogue entry. Publicly readable; only staff/seeders write."""

    name = models.CharField(max_length=120)
    slug = models.SlugField(max_length=140, unique=True)
    # Point(x=lng, y=lat, srid=4326) — note the coordinate order.
    point = gis_models.PointField(geography=True, srid=4326, spatial_index=True)

    avg_daily_budget = models.PositiveIntegerField(help_text="INR per person per day")
    budget_tier = models.CharField(max_length=10, choices=BudgetTier.choices)
    interest_tags = ArrayField(models.CharField(max_length=32), default=list, blank=True)
    best_season = models.CharField(max_length=60, blank=True)
    image_url = models.URLField(max_length=500, blank=True)
    # Extra photos for the detail page's gallery, beyond the card thumbnail above.
    image_urls = ArrayField(
        models.URLField(max_length=500), default=list, blank=True
    )
    # Photos come from Wikipedia/Wikimedia Commons (free licences that require
    # credit); this is the source page the UI links its "Photo" credit to.
    image_credit = models.URLField(max_length=500, blank=True)
    # Short, our own wording — shown on the detail page and to the assistant.
    description = models.TextField(blank=True)

    # Used by the Phase 2 region filter.
    region = models.CharField(max_length=60, blank=True)
    state = models.CharField(max_length=60, blank=True, db_index=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        indexes = [
            models.Index(fields=["avg_daily_budget"]),
            models.Index(fields=["budget_tier"]),
        ]

    def __str__(self):
        return self.name


class SavedDestination(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="saved_destinations",
    )
    destination = models.ForeignKey(
        Destination, on_delete=models.CASCADE, related_name="saved_by"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("user", "destination")]
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user_id} -> {self.destination_id}"


class DestinationReview(models.Model):
    """One traveller's rating/review of a destination.

    Open to any onboarded user, not gated on a recorded past trip there — see
    the P4 plan's rationale (gating would leave nearly every destination with
    zero reviews at launch). One review per person per place; a second write
    edits it in place rather than creating a duplicate (enforced at the
    serializer level, same upsert shape as SavedDestinationSerializer.create).
    """

    destination = models.ForeignKey(
        Destination, on_delete=models.CASCADE, related_name="reviews"
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="destination_reviews"
    )
    rating = models.PositiveSmallIntegerField()
    body = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("destination", "author")]
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(rating__gte=1) & models.Q(rating__lte=5),
                name="destination_review_rating_1_to_5",
            ),
        ]

    def __str__(self):
        return f"{self.author_id} rated {self.destination_id}: {self.rating}/5"
