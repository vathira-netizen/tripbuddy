from django.conf import settings
from django.db import models
from django.db.models import Q


class Connection(models.Model):
    """A buddy request between two travellers.

    A single row covers the pair in both directions: the requester sends, the
    addressee accepts/declines. Either side may block. Messaging (Phase 7) is
    gated on ``status == ACCEPTED``.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        ACCEPTED = "accepted", "Accepted"
        DECLINED = "declined", "Declined"
        BLOCKED = "blocked", "Blocked"

    requester = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="connections_sent",
    )
    addressee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="connections_received",
    )
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.PENDING
    )
    # Who pressed block — only they may unblock.
    blocked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="connections_blocked",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("requester", "addressee")]
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=~Q(requester=models.F("addressee")),
                name="connection_no_self_request",
            ),
        ]
        indexes = [
            models.Index(fields=["status"]),
        ]

    def __str__(self):
        return f"{self.requester_id} -> {self.addressee_id} ({self.status})"

    def involves(self, user):
        return user.pk in (self.requester_id, self.addressee_id)

    def other_user(self, user):
        return self.addressee if user.pk == self.requester_id else self.requester
