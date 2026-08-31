from django.contrib import admin
from django.contrib.gis.admin import GISModelAdmin

from apps.destinations.models import Destination, DestinationReview, SavedDestination


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


@admin.register(DestinationReview)
class DestinationReviewAdmin(admin.ModelAdmin):
    list_display = ("destination", "author", "rating", "created_at")
    list_filter = ("rating",)
    search_fields = ("destination__name", "author__email", "body")
