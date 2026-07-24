from django.conf import settings
from django.db import models


class Message(models.Model):
    """A chat message on an accepted connection.

    Django owns the write path; the browser reads this table directly through
    Supabase Realtime, so it also carries an RLS policy restricting rows to the
    connection's two participants (see the RLS migration in this app).
    """

    connection = models.ForeignKey(
        "connections.Connection", on_delete=models.CASCADE, related_name="messages"
    )
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="messages_sent",
    )
    body = models.TextField()
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [
            models.Index(fields=["connection", "created_at"]),
        ]

    def __str__(self):
        return f"{self.sender_id}: {self.body[:40]}"
