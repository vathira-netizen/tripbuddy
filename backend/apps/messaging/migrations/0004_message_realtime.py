"""Publish ``messaging_message`` to Supabase Realtime.

Supabase Realtime streams a table only when that table is a member of the
``supabase_realtime`` logical-replication publication. Adding it in the
dashboard (Database -> Replication) works, but that leaves the chat feature
depending on a manual click that no environment records — a fresh project would
look correct and silently deliver nothing. This migration makes it part of the
schema instead.

Safe to run repeatedly: membership is checked first, so re-running is a no-op
rather than a "relation is already member of publication" error.

RLS still applies. Realtime evaluates the SELECT policy per subscriber, so a
subscriber receives only rows ``tripbuddy_can_read_connection`` admits — i.e.
conversations on their own *accepted* connections (see 0003).

REPLICA IDENTITY is left at the default (primary key). Chat only needs INSERT
events, and FULL would put the entire old row into the WAL on every update —
unnecessary write amplification for a table holding message bodies.
"""

from django.db import migrations

FORWARD = """
DO $do$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        RAISE NOTICE 'No supabase_realtime publication - skipping (not a Supabase database).';
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'messaging_message'
    ) THEN
        RAISE NOTICE 'messaging_message is already published to Realtime.';
        RETURN;
    END IF;

    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.messaging_message';
END
$do$;
"""

REVERSE = """
DO $do$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'messaging_message'
    ) THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.messaging_message';
    END IF;
END
$do$;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("messaging", "0003_message_rls_accepted_only"),
    ]

    operations = [
        migrations.RunSQL(sql=FORWARD, reverse_sql=REVERSE),
    ]
