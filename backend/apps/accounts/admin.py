from django.contrib import admin
from django.contrib.gis.admin import GISModelAdmin

from apps.accounts.models import Profile


@admin.register(Profile)
class ProfileAdmin(GISModelAdmin):
    list_display = ("display_name", "supabase_user_id", "area_label", "onboarded")
    list_filter = ("onboarded", "budget_style", "age_band")
    search_fields = ("display_name", "area_label", "supabase_user_id", "user__email")
    readonly_fields = ("supabase_user_id", "created_at", "updated_at")
