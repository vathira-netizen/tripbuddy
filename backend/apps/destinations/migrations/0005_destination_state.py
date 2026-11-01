from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("destinations", "0004_destinationreview")]

    operations = [
        migrations.AddField(
            model_name="destination",
            name="state",
            field=models.CharField(blank=True, db_index=True, max_length=60),
        ),
    ]
