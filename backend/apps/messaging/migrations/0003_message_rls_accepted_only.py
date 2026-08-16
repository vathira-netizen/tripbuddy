"""Gate the browser's direct read path on an *accepted* connection.

0002 gated Realtime reads on being a participant of the connection. That is
weaker than the rule the API enforces (``apps.connections.views.can_message``
requires ``status == 'accepted'``), and the gap is reachable:

* a **blocked** participant kept SELECT on the whole conversation, so blocking
  stopped new messages but not continued live reading of the history;
* a **pending** or **declined** request exposed nothing today only because no
  message can be written before acceptance — it was a latent hole, not a
  guarantee.

This replaces the helper with one that answers the question the product
actually asks: "may this user read this conversation *now*?". Blocking a
connection therefore revokes read access immediately, on the next Realtime
query, without any application code running.

The old function is dropped once nothing references it. As in 0002, every
statement is guarded so the migration is a no-op on a non-Supabase database
(the plain postgis image CI runs against has no ``auth.uid()``).
"""

from django.db import migrations

CREATE_HELPER = """
CREATE OR REPLACE FUNCTION public.tripbuddy_can_read_connection(conn_id bigint)
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
          AND c.status = 'accepted'
          AND p.supabase_user_id = auth.uid()
    );
$fn$;
"""

FORWARD = f"""
DO $do$
BEGIN
    IF to_regprocedure('auth.uid()') IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        RAISE NOTICE 'Not a Supabase database - skipping messaging RLS tightening.';
        RETURN;
    END IF;

    EXECUTE $sql${CREATE_HELPER}$sql$;

    EXECUTE 'REVOKE ALL ON FUNCTION public.tripbuddy_can_read_connection(bigint) FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.tripbuddy_can_read_connection(bigint) TO authenticated';

    -- Repoint the policy before dropping what it used to depend on.
    EXECUTE 'DROP POLICY IF EXISTS messaging_message_select_participants ON public.messaging_message';
    EXECUTE $sql$
        CREATE POLICY messaging_message_select_participants
        ON public.messaging_message
        FOR SELECT
        TO authenticated
        USING (public.tripbuddy_can_read_connection(connection_id))
    $sql$;

    EXECUTE 'DROP FUNCTION IF EXISTS public.tripbuddy_is_connection_participant(bigint)';
END
$do$;
"""

REVERSE = """
DO $do$
BEGIN
    IF to_regprocedure('auth.uid()') IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        RETURN;
    END IF;

    EXECUTE $sql$
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
        $fn$
    $sql$;

    EXECUTE 'REVOKE ALL ON FUNCTION public.tripbuddy_is_connection_participant(bigint) FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.tripbuddy_is_connection_participant(bigint) TO authenticated';

    EXECUTE 'DROP POLICY IF EXISTS messaging_message_select_participants ON public.messaging_message';
    EXECUTE $sql$
        CREATE POLICY messaging_message_select_participants
        ON public.messaging_message
        FOR SELECT
        TO authenticated
        USING (public.tripbuddy_is_connection_participant(connection_id))
    $sql$;

    EXECUTE 'DROP FUNCTION IF EXISTS public.tripbuddy_can_read_connection(bigint)';
END
$do$;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("messaging", "0002_message_rls"),
    ]

    operations = [
        migrations.RunSQL(sql=FORWARD, reverse_sql=REVERSE),
    ]
