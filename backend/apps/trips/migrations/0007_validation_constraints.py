from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('destinations', '0006_destination_description_image_credit'),
        ('trips', '0006_trip_join_deadline'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddConstraint(
            model_name='trip',
            constraint=models.CheckConstraint(condition=models.Q(('start_date__isnull', True), ('end_date__isnull', True), ('end_date__gte', models.F('start_date')), _connector='OR'), name='trip_ends_on_or_after_start'),
        ),
    ]
