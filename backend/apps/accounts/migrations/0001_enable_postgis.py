from django.contrib.postgres.operations import CreateExtension
from django.db import migrations


class Migration(migrations.Migration):
    """Enables the PostGIS extension on the Supabase Postgres database.

    No-op on non-Postgres backends (e.g. local sqlite fallback).
    """

    initial = True

    dependencies = []

    operations = [
        CreateExtension("postgis"),
    ]
