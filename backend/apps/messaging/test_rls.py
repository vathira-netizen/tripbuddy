"""The RLS policy that guards the Realtime read path.

Django's API enforces "accepted connection" in Python (apps/messaging/views.py).
Realtime does not run any of that code: Postgres decides, per subscriber, using
the SELECT policy on ``messaging_message``. So the policy is a second, wholly
independent implementation of the same rule — and an untested one is how a
blocked traveller keeps reading a conversation.

CI runs against a plain postgis image with no Supabase ``auth`` schema, which is
exactly why the RLS migrations are written to no-op there. These tests therefore
build the small part of Supabase the policy depends on — an ``auth.uid()``
reading the JWT claim, and the ``authenticated`` role — then apply the real
migration SQL and query the table *as that role*. What is asserted is the
policy's actual behaviour in Postgres, not the text of the migration.
"""

import importlib
import uuid

import pytest
from django.contrib.auth import get_user_model
from django.db import connection

from apps.accounts.models import Profile
from apps.connections.models import Connection
from apps.messaging.models import Message

User = get_user_model()

rls_0002 = importlib.import_module("apps.messaging.migrations.0002_message_rls")
rls_0003 = importlib.import_module(
    "apps.messaging.migrations.0003_message_rls_accepted_only"
)

# A minimal stand-in for Supabase's auth.uid(): reads the JWT subject from a
# session setting, which is how Supabase surfaces it to policies.
SUPABASE_SHIM = """
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
"""


def supabase_shim_available(cursor):
    """Create the auth shim and the `authenticated` role, or report we cannot."""
    try:
        cursor.execute(SUPABASE_SHIM)
        # Both of Supabase's browser-facing roles: the migrations revoke from
        # `anon` as well, so it has to exist for the SQL to run unchanged.
        for role in ("anon", "authenticated"):
            cursor.execute(
                "DO $$ BEGIN "
                f"IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{role}') "
                f"THEN CREATE ROLE {role} NOLOGIN; END IF; END $$;"
            )
        return True
    except Exception:  # pragma: no cover - only on a locked-down test database
        return False


def as_authenticated(cursor, supabase_user_id):
    """Switch the session to the browser's role with a given JWT subject.

    Session-scoped, not ``SET LOCAL``: these tests run with autocommit, where
    ``SET LOCAL`` silently does nothing — leaving every query running as the
    superuser, which bypasses RLS and makes the policy look permissive.
    """
    cursor.execute(
        "SELECT set_config('request.jwt.claim.sub', %s, false)",
        [str(supabase_user_id) if supabase_user_id else ""],
    )
    cursor.execute("SET ROLE authenticated")


def reset_role(cursor):
    cursor.execute("RESET ROLE")
    cursor.execute("SELECT set_config('request.jwt.claim.sub', '', false)")


def read_count_as(cursor, supabase_user_id):
    """Rows of messaging_message visible to that Supabase user, under RLS."""
    as_authenticated(cursor, supabase_user_id)
    try:
        cursor.execute("SELECT count(*) FROM public.messaging_message")
        return cursor.fetchone()[0]
    finally:
        reset_role(cursor)


def make_traveller(username):
    user = User.objects.create_user(username=username)
    profile = Profile.objects.create(
        user=user,
        supabase_user_id=uuid.uuid4(),
        display_name=username.title(),
        onboarded=True,
    )
    return user, profile


@pytest.fixture
def rls(db):
    """Apply the real migration SQL against a Supabase-shaped test database."""
    cursor = connection.cursor()
    if not supabase_shim_available(cursor):
        pytest.skip("cannot create the auth shim on this database")

    # The migrations skipped these statements at migrate time (no auth schema
    # existed yet); run the same SQL now that there is one.
    cursor.execute(rls_0002.FORWARD)
    cursor.execute(rls_0003.FORWARD)

    cursor.execute(
        "SELECT polname, pg_get_expr(polqual, polrelid) FROM pg_policy "
        "WHERE polrelid = 'public.messaging_message'::regclass"
    )
    assert cursor.fetchall(), "the policy was not created"
    yield cursor


@pytest.mark.django_db(transaction=True)
def test_participants_of_an_accepted_connection_can_read(rls):
    alice_user, alice = make_traveller("alice")
    bob_user, bob = make_traveller("bob")
    conn = Connection.objects.create(
        requester=alice_user, addressee=bob_user, status=Connection.Status.ACCEPTED
    )
    Message.objects.create(connection=conn, sender=alice_user, body="hello")

    assert read_count_as(rls, alice.supabase_user_id) == 1
    assert read_count_as(rls, bob.supabase_user_id) == 1


@pytest.mark.django_db(transaction=True)
def test_a_stranger_sees_nothing(rls):
    alice_user, _ = make_traveller("alice")
    bob_user, _ = make_traveller("bob")
    _, mallory = make_traveller("mallory")
    conn = Connection.objects.create(
        requester=alice_user, addressee=bob_user, status=Connection.Status.ACCEPTED
    )
    Message.objects.create(connection=conn, sender=alice_user, body="private")

    assert read_count_as(rls, mallory.supabase_user_id) == 0


@pytest.mark.django_db(transaction=True)
def test_an_unauthenticated_subscriber_sees_nothing(rls):
    alice_user, _ = make_traveller("alice")
    bob_user, _ = make_traveller("bob")
    conn = Connection.objects.create(
        requester=alice_user, addressee=bob_user, status=Connection.Status.ACCEPTED
    )
    Message.objects.create(connection=conn, sender=alice_user, body="private")

    # auth.uid() is NULL when no JWT subject is set.
    as_authenticated(rls, None)
    try:
        rls.execute("SELECT count(*) FROM public.messaging_message")
        assert rls.fetchone()[0] == 0
    finally:
        reset_role(rls)


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("state", ["pending", "declined", "blocked"])
def test_reads_are_revoked_when_the_connection_is_not_accepted(rls, state):
    """The gap migration 0003 closed: participation alone used to be enough."""
    alice_user, alice = make_traveller("alice")
    bob_user, bob = make_traveller("bob")
    conn = Connection.objects.create(
        requester=alice_user, addressee=bob_user, status=Connection.Status.ACCEPTED
    )
    Message.objects.create(connection=conn, sender=alice_user, body="history")
    assert read_count_as(rls, bob.supabase_user_id) == 1

    Connection.objects.filter(pk=conn.pk).update(status=state)

    # Both sides lose live access to the history, not just to new messages.
    assert read_count_as(rls, alice.supabase_user_id) == 0
    assert read_count_as(rls, bob.supabase_user_id) == 0


@pytest.mark.django_db(transaction=True)
def test_a_subscriber_sees_only_their_own_conversations(rls):
    alice_user, alice = make_traveller("alice")
    bob_user, _ = make_traveller("bob")
    carol_user, _ = make_traveller("carol")
    dave_user, _ = make_traveller("dave")

    mine = Connection.objects.create(
        requester=alice_user, addressee=bob_user, status=Connection.Status.ACCEPTED
    )
    theirs = Connection.objects.create(
        requester=carol_user, addressee=dave_user, status=Connection.Status.ACCEPTED
    )
    Message.objects.create(connection=mine, sender=alice_user, body="mine")
    Message.objects.create(connection=theirs, sender=carol_user, body="not mine")
    Message.objects.create(connection=theirs, sender=dave_user, body="also not mine")

    # Three rows in the table; Alice may see exactly one.
    assert Message.objects.count() == 3
    assert read_count_as(rls, alice.supabase_user_id) == 1


@pytest.mark.django_db(transaction=True)
def test_the_browser_role_cannot_write(rls):
    """Realtime is a read path. Every write goes through the Django API."""
    alice_user, alice = make_traveller("alice")
    bob_user, _ = make_traveller("bob")
    conn = Connection.objects.create(
        requester=alice_user, addressee=bob_user, status=Connection.Status.ACCEPTED
    )

    as_authenticated(rls, alice.supabase_user_id)
    try:
        with pytest.raises(Exception):
            rls.execute(
                "INSERT INTO public.messaging_message "
                "(connection_id, sender_id, body, created_at) "
                "VALUES (%s, %s, 'forged', now())",
                [conn.pk, alice_user.pk],
            )
    finally:
        reset_role(rls)

    assert Message.objects.count() == 0
