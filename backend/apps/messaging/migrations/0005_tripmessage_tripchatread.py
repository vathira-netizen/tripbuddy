import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

# Group chat is API-only: deny the direct browser path, like trips_chatmessage.
# No-op off Supabase.
RLS_FORWARD = """
DO $do$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        RAISE NOTICE 'Not a Supabase database - skipping trip chat RLS setup.';
        RETURN;
    END IF;
    EXECUTE 'ALTER TABLE public.messaging_tripmessage ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON TABLE public.messaging_tripmessage FROM anon, authenticated';
    EXECUTE 'ALTER TABLE public.messaging_tripchatread ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON TABLE public.messaging_tripchatread FROM anon, authenticated';
END
$do$;
"""

RLS_REVERSE = """
DO $do$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        RETURN;
    END IF;
    EXECUTE 'ALTER TABLE public.messaging_tripmessage DISABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.messaging_tripchatread DISABLE ROW LEVEL SECURITY';
END
$do$;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("messaging", "0004_message_realtime"),
        ("trips", "0005_conversation_chatmessage"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="TripMessage",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("body", models.TextField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("sender", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="trip_messages_sent", to=settings.AUTH_USER_MODEL)),
                ("trip", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="chat_messages", to="trips.trip")),
            ],
            options={
                "ordering": ["created_at", "id"],
                "indexes": [models.Index(fields=["trip", "created_at"], name="messaging_t_trip_id_2a6c00_idx")],
            },
        ),
        migrations.CreateModel(
            name="TripChatRead",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("last_read_at", models.DateTimeField()),
                ("trip", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="chat_reads", to="trips.trip")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="trip_chat_reads", to=settings.AUTH_USER_MODEL)),
            ],
            options={"unique_together": {("trip", "user")}},
        ),
        migrations.RunSQL(sql=RLS_FORWARD, reverse_sql=RLS_REVERSE),
    ]
