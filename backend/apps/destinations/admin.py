from django.contrib import admin
from django.contrib.gis.admin import GISModelAdmin

from apps.destinations.models import Destination, SavedDestination


@admin.register(Destination)
class DestinationAdmin(GISModelAdmin):
    list_display = ("name", "slug", "region", "avg_daily_budget", "budget_tier")
    list_filter = ("budget_tier", "region")
    search_fields = ("name", "slug", "region")
    prepopulated_fields = {"slug": ("name",)}


@admin.register(SavedDestination)
class SavedDestinationAdmin(admin.ModelAdmin):
    list_display = ("user", "destination", "created_at")
    search_fields = ("user__email", "destination__name")
