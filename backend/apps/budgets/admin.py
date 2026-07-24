from django.contrib import admin

from apps.budgets.models import BudgetItem


@admin.register(BudgetItem)
class BudgetItemAdmin(admin.ModelAdmin):
    list_display = ("trip", "category", "label", "amount", "payer")
    list_filter = ("category",)
    search_fields = ("label", "trip__title")
