from django.contrib import admin

from apps.trips.models import ItineraryItem, Trip, TripCollaborator


class TripCollaboratorInline(admin.TabularInline):
    model = TripCollaborator
    extra = 0


class ItineraryItemInline(admin.TabularInline):
    model = ItineraryItem
    extra = 0


@admin.register(Trip)
class TripAdmin(admin.ModelAdmin):
    list_display = ("title", "owner", "start_date", "end_date", "is_public")
    list_filter = ("is_public",)
    search_fields = ("title", "owner__email")
    inlines = [TripCollaboratorInline, ItineraryItemInline]


admin.site.register(TripCollaborator)
admin.site.register(ItineraryItem)
