from django.contrib import admin

from apps.connections.models import Connection


@admin.register(Connection)
class ConnectionAdmin(admin.ModelAdmin):
    list_display = ("requester", "addressee", "status", "created_at")
    list_filter = ("status",)
    search_fields = ("requester__email", "addressee__email")
