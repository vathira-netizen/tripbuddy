from django.conf import settings
from django.db import models


class Report(models.Model):
    """A safety report filed by one traveller against another.

    Reviewed through the Django admin — this phase adds the ability to file a
    report, not a dedicated moderation queue UI.
    """

    class Reason(models.TextChoices):
        HARASSMENT = "harassment", "Harassment"
        INAPPROPRIATE_CONTENT = "inappropriate_content", "Inappropriate content"
        SPAM = "spam", "Spam"
        SAFETY_CONCERN = "safety_concern", "Safety concern"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        REVIEWED = "reviewed", "Reviewed"
        ACTIONED = "actioned", "Actioned"

    reporter = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reports_filed"
    )
    reported_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reports_received"
    )
    reason = models.CharField(max_length=30, choices=Reason.choices)
    details = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status"]),
        ]

    def __str__(self):
        return f"{self.reporter_id} reported {self.reported_user_id} ({self.reason})"
