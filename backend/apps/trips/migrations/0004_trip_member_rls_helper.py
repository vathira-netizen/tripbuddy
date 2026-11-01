"""SECURITY DEFINER helper for the trip-covers storage policy.

The Supabase Storage RLS policies on the `trip-covers` bucket check trip
membership by querying `trips_trip` / `trips_tripcollaborator` directly. The
`authenticated` role has no grant on those tables (0003_lock_down_direct_table_access
in apps.accounts revoked Supabase's blanket default grant and only whitelisted
destinations_destination and messaging_message), so every such query fails with
"permission denied for table trips_trip" — surfaced to the browser as a 403 on
upload.

Mirrors messaging's tripbuddy_is_connection_participant (apps.messaging
0002_message_rls): a SECURITY DEFINER function can read the tables its owner
can read, without granting `authenticated` direct table access. Update the
trip-covers bucket's storage.objects policies to call this instead of
querying trips_trip/trips_tripcollaborator inline.
"""

from django.db import migrations

CREATE_HELPER = """
CREATE OR REPLACE FUNCTION public.tripbuddy_is_trip_member(trip_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $fn$
    SELECT EXISTS (
        SELECT 1
        FROM public.trips_trip t
        LEFT JOIN public.trips_tripcollaborator tc ON tc.trip_id = t.id
        JOIN public.accounts_profile p
          ON p.user_id = t.owner_id OR p.user_id = tc.user_id
        WHERE t.id = trip_id
          AND p.supabase_user_id = auth.uid()
    );
$fn$;
"""

FORWARD = f"""
DO $do$
BEGIN
    IF to_regprocedure('auth.uid()') IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        RAISE NOTICE 'Not a Supabase database - skipping trip member RLS helper.';
        RETURN;
    END IF;

    EXECUTE $sql${CREATE_HELPER}$sql$;

    EXECUTE 'REVOKE ALL ON FUNCTION public.tripbuddy_is_trip_member(bigint) FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.tripbuddy_is_trip_member(bigint) TO authenticated';
END
$do$;
"""

REVERSE = """
DO $do$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        RETURN;
    END IF;

    EXECUTE 'DROP FUNCTION IF EXISTS public.tripbuddy_is_trip_member(bigint)';
END
$do$;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("trips", "0003_trip_cover_image_url_trip_is_open_to_join_and_more"),
        ("accounts", "0002_initial"),
    ]

    operations = [
        migrations.RunSQL(sql=FORWARD, reverse_sql=REVERSE),
    ]
