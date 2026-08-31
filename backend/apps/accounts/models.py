import uuid

from django.conf import settings
from django.contrib.gis.db import models as gis_models
from django.contrib.postgres.fields import ArrayField
from django.db import models

from apps.common.choices import AgeBand, BudgetStyle, Gender


class Profile(models.Model):
    """A traveller's profile, keyed by their Supabase user id.

    Privacy: ``area_point`` is the geocoded centre of a *city* the user typed,
    never a device location. It is used for proximity scoring only and is never
    serialised to another user — see ``PublicProfileSerializer``.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="profile",
    )
    # The `sub` claim of the Supabase JWT. This, not the Django pk, is the
    # stable cross-system identity for a traveller.
    supabase_user_id = models.UUIDField(unique=True, default=uuid.uuid4, editable=False)

    display_name = models.CharField(max_length=60, blank=True)
    # Public URL of the file in the Supabase Storage `avatars` bucket. Uploaded
    # directly from the browser via the Supabase client; Django only stores the
    # resulting URL, never handles the file itself.
    avatar_url = models.URLField(blank=True, default="")
    bio = models.CharField(max_length=280, blank=True)
    travel_styles = ArrayField(models.CharField(max_length=20), default=list, blank=True)
    # UPI virtual payment address (e.g. "name@okbank") for the group settle-up
    # feature — shown only to fellow trip members who owe this person money,
    # never broadcast publicly. Format varies by bank/PSP, so validation is
    # deliberately loose (see ProfileSerializer.validate_upi_vpa).
    upi_vpa = models.CharField(max_length=80, blank=True)
    # Synced opportunistically from the Supabase JWT's `email_verified` claim on
    # each authenticated request — see apps.accounts.authentication.
    email_verified = models.BooleanField(default=False)
    age_band = models.CharField(max_length=10, choices=AgeBand.choices, blank=True)
    gender = models.CharField(max_length=20, choices=Gender.choices, blank=True)
    languages = ArrayField(models.CharField(max_length=32), default=list, blank=True)
    interests = ArrayField(models.CharField(max_length=32), default=list, blank=True)
    budget_style = models.CharField(
        max_length=10, choices=BudgetStyle.choices, blank=True
    )
    daily_budget = models.PositiveIntegerField(null=True, blank=True)

    # The city the user typed, e.g. "Bengaluru, Karnataka".
    area_label = models.CharField(max_length=120, blank=True)
    # geography=True so PostGIS distances come back in metres on the spheroid.
    # spatial_index=True (the default) is what creates the GiST index.
    area_point = gis_models.PointField(
        geography=True, srid=4326, null=True, blank=True, spatial_index=True
    )

    onboarded = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["onboarded"]),
        ]

    def __str__(self):
        return self.display_name or str(self.supabase_user_id)
