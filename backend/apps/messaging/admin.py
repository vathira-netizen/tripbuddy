from django.contrib import admin

from apps.messaging.models import Message


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ("connection", "sender", "created_at", "read_at")
    search_fields = ("sender__email", "body")
