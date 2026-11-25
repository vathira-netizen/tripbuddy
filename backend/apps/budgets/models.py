from django.conf import settings
from django.db import models


class BudgetItem(models.Model):
    class Category(models.TextChoices):
        TRANSPORT = "Transport", "Transport"
        STAY = "Stay", "Stay"
        FOOD = "Food", "Food"
        ACTIVITIES = "Activities", "Activities"
        OTHER = "Other", "Other"

    trip = models.ForeignKey(
        "trips.Trip", on_delete=models.CASCADE, related_name="budget_items"
    )
    category = models.CharField(max_length=20, choices=Category.choices)
    label = models.CharField(max_length=200)
    amount = models.DecimalField(max_digits=10, decimal_places=2)  # > 0, see Meta
    # Who actually paid — drives the paid-vs-owed split in Phase 3.
    payer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="budget_items_paid",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(amount__gt=0), name="budget_item_amount_positive"
            ),
        ]
        ordering = ["category", "id"]
        indexes = [
            models.Index(fields=["trip", "category"]),
        ]

    def __str__(self):
        return f"{self.category}: {self.label} ({self.amount})"
