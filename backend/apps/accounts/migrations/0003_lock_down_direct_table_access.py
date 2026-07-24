"""Close the browser's direct read/write path to every table except the two we opened.

Supabase ships a default-privilege grant (``ALTER DEFAULT PRIVILEGES IN SCHEMA
public GRANT ALL ON TABLES TO anon, authenticated``) so that tables you create
in the dashboard are immediately usable from PostgREST. Django's ``migrate``
inherits it: without this migration every table it creates — ``auth_user``,
``accounts_profile``, ``trips_trip``, ``connections_connection`` — is readable
AND writable by anyone holding the public anon key, straight over the Supabase
REST API, with Django and its DRF permissions bypassed entirely.

TripBuddy's public schema is Django-managed and the browser is never meant to
touch it directly. So the rule here is deny-by-default:

  * revoke anon/authenticated privileges on every Django table,
  * enable RLS on them all (with no policy, that denies those roles outright),
  * re-open exactly the two documented exceptions — public read on
    ``destinations_destination`` and participants-only read on
    ``messaging_message`` (Realtime chat) — which the RLS migrations in those
    apps define,
  * and change the default privileges so migrations in later phases do not
    silently re-open the hole for new tables.

PostGIS's own catalogue tables are left alone: the roles need them.
"""

from django.db import migrations

POSTGIS_TABLES = "'spatial_ref_sys', 'geometry_columns', 'geography_columns'"

FORWARD = f"""
DO $do$
DECLARE
    tbl record;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
       OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        RAISE NOTICE 'Not a Supabase database - skipping table lockdown.';
        RETURN;
    END IF;

    FOR tbl IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename NOT IN ({POSTGIS_TABLES})
    LOOP
        EXECUTE format(
            'REVOKE ALL ON TABLE public.%I FROM anon, authenticated', tbl.tablename
        );
        EXECUTE format(
            'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl.tablename
        );
    END LOOP;

    -- Stop future migrations from inheriting Supabase's blanket grant.
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated';

    -- The two deliberate exceptions (policies live in the owning apps).
    EXECUTE 'GRANT SELECT ON TABLE public.destinations_destination TO anon, authenticated';
    EXECUTE 'GRANT SELECT ON TABLE public.messaging_message TO authenticated';
END
$do$;
"""

# Deliberately does NOT restore the blanket ALL grant — that would re-create the
# hole. It only lifts the RLS flag and the default-privilege change.
REVERSE = f"""
DO $do$
DECLARE
    tbl record;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        RETURN;
    END IF;

    FOR tbl IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename NOT IN ({POSTGIS_TABLES}, 'destinations_destination',
                                'destinations_saveddestination', 'messaging_message')
    LOOP
        EXECUTE format(
            'ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', tbl.tablename
        );
    END LOOP;

    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated';
END
$do$;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0002_initial"),
        ("budgets", "0001_initial"),
        ("connections", "0001_initial"),
        ("destinations", "0002_destination_rls"),
        ("messaging", "0002_message_rls"),
        ("trips", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(sql=FORWARD, reverse_sql=REVERSE),
    ]
