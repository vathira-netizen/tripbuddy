from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("trips", "0005_conversation_chatmessage"),
    ]

    operations = [
        migrations.AddField(
            model_name="trip",
            name="join_deadline",
            field=models.DateField(blank=True, null=True),
        ),
    ]
