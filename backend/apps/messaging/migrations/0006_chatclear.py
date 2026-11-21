import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

# API-only, like the trip chat tables: deny the direct browser path. No-op off
# Supabase.
RLS_FORWARD = """
DO $do$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        RAISE NOTICE 'Not a Supabase database - skipping chat clear RLS setup.';
        RETURN;
    END IF;
    EXECUTE 'ALTER TABLE public.messaging_chatclear ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON TABLE public.messaging_chatclear FROM anon, authenticated';
END
$do$;
"""

RLS_REVERSE = """
DO $do$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        RETURN;
    END IF;
    EXECUTE 'ALTER TABLE public.messaging_chatclear DISABLE ROW LEVEL SECURITY';
END
$do$;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('connections', '0001_initial'),
        ('messaging', '0005_tripmessage_tripchatread'),
        ('trips', '0006_trip_join_deadline'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='ChatClear',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('cleared_at', models.DateTimeField()),
                ('connection', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='clears', to='connections.connection')),
                ('trip', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='chat_clears', to='trips.trip')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='chat_clears', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'constraints': [models.CheckConstraint(condition=models.Q(models.Q(('connection__isnull', False), ('trip__isnull', True)), models.Q(('connection__isnull', True), ('trip__isnull', False)), _connector='OR'), name='chatclear_one_target'), models.UniqueConstraint(condition=models.Q(('connection__isnull', False)), fields=('user', 'connection'), name='chatclear_unique_connection'), models.UniqueConstraint(condition=models.Q(('trip__isnull', False)), fields=('user', 'trip'), name='chatclear_unique_trip')],
            },
        ),
        migrations.RunSQL(sql=RLS_FORWARD, reverse_sql=RLS_REVERSE),
    ]
