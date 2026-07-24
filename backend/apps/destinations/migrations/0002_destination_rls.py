"""Row-Level Security for the destination catalogue.

The catalogue is public reference data, so the policy is simply "everyone reads,
nobody writes". Seeding (Phase 2) happens through Django, which bypasses RLS.

Guarded so it is a no-op off Supabase — see the messaging RLS migration for the
fuller explanation of why RLS exists at all here.
"""

from django.db import migrations

FORWARD = """
DO $do$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
       OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        RAISE NOTICE 'Not a Supabase database - skipping destinations RLS setup.';
        RETURN;
    END IF;

    EXECUTE 'ALTER TABLE public.destinations_destination ENABLE ROW LEVEL SECURITY';

    EXECUTE 'REVOKE ALL ON TABLE public.destinations_destination FROM anon, authenticated';
    EXECUTE 'GRANT SELECT ON TABLE public.destinations_destination TO anon, authenticated';

    EXECUTE 'DROP POLICY IF EXISTS destinations_destination_public_read ON public.destinations_destination';
    EXECUTE $sql$
        CREATE POLICY destinations_destination_public_read
        ON public.destinations_destination
        FOR SELECT
        TO anon, authenticated
        USING (true)
    $sql$;

    -- A traveller's saved list is private; the browser has no reason to read it
    -- directly, so deny the direct path outright and let the API serve it.
    EXECUTE 'ALTER TABLE public.destinations_saveddestination ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON TABLE public.destinations_saveddestination FROM anon, authenticated';
END
$do$;
"""

REVERSE = """
DO $do$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        RETURN;
    END IF;

    EXECUTE 'DROP POLICY IF EXISTS destinations_destination_public_read ON public.destinations_destination';
    EXECUTE 'ALTER TABLE public.destinations_destination DISABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.destinations_saveddestination DISABLE ROW LEVEL SECURITY';
END
$do$;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("destinations", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(sql=FORWARD, reverse_sql=REVERSE),
    ]
