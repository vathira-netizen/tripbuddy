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


class TripMessage(models.Model):
    """A message in a trip's group chat; every trip member can read and write.

    Served only through the API (no browser/Realtime path), so the table is
    locked down to Django in its migration.
    """

    trip = models.ForeignKey(
        "trips.Trip", on_delete=models.CASCADE, related_name="chat_messages"
    )
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="trip_messages_sent",
    )
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [models.Index(fields=["trip", "created_at"])]

    def __str__(self):
        return f"{self.sender_id}@{self.trip_id}: {self.body[:40]}"


class TripChatRead(models.Model):
    """How far each member has read a trip chat.

    One row per (trip, member) instead of a read flag per message: it gives both
    the unread badge and "Seen by N" (members whose ``last_read_at`` is at or
    after a message) without a row per message per reader.
    """

    trip = models.ForeignKey(
        "trips.Trip", on_delete=models.CASCADE, related_name="chat_reads"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="trip_chat_reads",
    )
    last_read_at = models.DateTimeField()

    class Meta:
        unique_together = [("trip", "user")]
