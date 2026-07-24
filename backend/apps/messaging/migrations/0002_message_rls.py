"""Row-Level Security for the browser's direct read path on messages.

Django connects as a privileged role and bypasses RLS entirely — authorization
for the API lives in DRF (``apps.common.permissions`` / ``querysets``). This
policy exists for the *other* path: the React client subscribes to INSERTs on
``messaging_message`` through Supabase Realtime using the anon key plus the
user's JWT, and Realtime only delivers rows the policy allows. Without it,
subscribing would leak every conversation in the database.

The whole thing is a no-op on a database that is not Supabase (e.g. the plain
postgis image CI runs against), which is why every statement is guarded.
"""

from django.db import migrations

# A SECURITY DEFINER helper: it runs as the function owner, so it can read
# accounts_profile and connections_connection without the `authenticated` role
# needing SELECT on them. It answers exactly one question and leaks nothing else.
CREATE_HELPER = """
CREATE OR REPLACE FUNCTION public.tripbuddy_is_connection_participant(conn_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $fn$
    SELECT EXISTS (
        SELECT 1
        FROM public.connections_connection c
        JOIN public.accounts_profile p
          ON p.user_id IN (c.requester_id, c.addressee_id)
        WHERE c.id = conn_id
          AND p.supabase_user_id = auth.uid()
    );
$fn$;
"""

FORWARD = f"""
DO $do$
BEGIN
    -- Only meaningful on Supabase: needs the auth schema and its roles.
    IF to_regprocedure('auth.uid()') IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        RAISE NOTICE 'Not a Supabase database - skipping messaging RLS setup.';
        RETURN;
    END IF;

    EXECUTE $sql${CREATE_HELPER}$sql$;

    EXECUTE 'REVOKE ALL ON FUNCTION public.tripbuddy_is_connection_participant(bigint) FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.tripbuddy_is_connection_participant(bigint) TO authenticated';

    EXECUTE 'ALTER TABLE public.messaging_message ENABLE ROW LEVEL SECURITY';

    -- The browser reads only. Every write goes through the Django API, which is
    -- where the "connection must be accepted and not blocked" rule is enforced.
    EXECUTE 'REVOKE ALL ON TABLE public.messaging_message FROM anon, authenticated';
    EXECUTE 'GRANT SELECT ON TABLE public.messaging_message TO authenticated';

    EXECUTE 'DROP POLICY IF EXISTS messaging_message_select_participants ON public.messaging_message';
    EXECUTE $sql$
        CREATE POLICY messaging_message_select_participants
        ON public.messaging_message
        FOR SELECT
        TO authenticated
        USING (public.tripbuddy_is_connection_participant(connection_id))
    $sql$;
END
$do$;
"""

REVERSE = """
DO $do$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        RETURN;
    END IF;

    EXECUTE 'DROP POLICY IF EXISTS messaging_message_select_participants ON public.messaging_message';
    EXECUTE 'ALTER TABLE public.messaging_message DISABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP FUNCTION IF EXISTS public.tripbuddy_is_connection_participant(bigint)';
END
$do$;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("messaging", "0001_initial"),
        ("connections", "0001_initial"),
        ("accounts", "0002_initial"),
    ]

    operations = [
        migrations.RunSQL(sql=FORWARD, reverse_sql=REVERSE),
    ]
