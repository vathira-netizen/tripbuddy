from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('budgets', '0001_initial'),
        ('trips', '0006_trip_join_deadline'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddConstraint(
            model_name='budgetitem',
            constraint=models.CheckConstraint(condition=models.Q(('amount__gt', 0)), name='budget_item_amount_positive'),
        ),
    ]
