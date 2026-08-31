from django.contrib import admin

from apps.trips.models import ItineraryItem, Trip, TripCollaborator, TripJoinRequest


class TripCollaboratorInline(admin.TabularInline):
    model = TripCollaborator
    extra = 0


class ItineraryItemInline(admin.TabularInline):
    model = ItineraryItem
    extra = 0


@admin.register(Trip)
class TripAdmin(admin.ModelAdmin):
    list_display = ("title", "owner", "start_date", "end_date", "is_public", "is_open_to_join")
    list_filter = ("is_public", "is_open_to_join")
    search_fields = ("title", "owner__email")
    inlines = [TripCollaboratorInline, ItineraryItemInline]


@admin.register(TripJoinRequest)
class TripJoinRequestAdmin(admin.ModelAdmin):
    list_display = ("trip", "requester", "status", "created_at")
    list_filter = ("status",)
    search_fields = ("trip__title", "requester__email")


admin.site.register(TripCollaborator)
admin.site.register(ItineraryItem)
