"""Attach a real Supabase user to the seeded pilot data for a demo.

`seed_pilot` creates browsable content owned by fictitious pilot users that
nobody can log into. This command takes a REAL Supabase auth user (which you
create in the Supabase dashboard) and wires them into that content so, once
they sign in, Trips / Buddies / Messages are all populated.

    python manage.py attach_demo_user --supabase-id <uuid> --email you@x.com --name "Demo"

It provisions the local User+Profile exactly the way a first login would (via
the auth layer), then:
  * adds the user as an editor on every seeded trip,
  * creates a few accepted buddy connections with pilot users,
  * drops a starter message into one of those threads.

Idempotent: re-running only fills gaps. `--undo` removes what it added.
"""

import uuid

from django.contrib.gis.geos import Point
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.authentication import SupabaseJWTAuthentication
from apps.accounts.models import Profile
from apps.connections.models import Connection
from apps.messaging.models import Message
from apps.trips.models import Trip, TripCollaborator

from .seed_pilot import CITIES, COORDINATE_PRECISION, PILOT_PREFIX

CONNECT_COUNT = 5  # accepted buddy connections to create with pilot users


class Command(BaseCommand):
    help = "Wire a real Supabase user into the seeded pilot data for a demo."

    def add_arguments(self, parser):
        parser.add_argument("--supabase-id", required=True, help="The Supabase user UID (uuid).")
        parser.add_argument("--email", default="", help="The user's email (optional).")
        parser.add_argument("--name", default="", help="Display name to show (optional).")
        parser.add_argument("--undo", action="store_true", help="Remove what this added.")

    def handle(self, *args, **opts):
        try:
            sub = str(uuid.UUID(str(opts["supabase_id"])))
        except ValueError:
            raise CommandError("--supabase-id must be a valid UUID (copy it from Supabase > Authentication > Users).")

        # Same provisioning a first authenticated request would do — guarantees
        # the User/Profile match what the login will resolve to.
        user = SupabaseJWTAuthentication().get_or_create_user(sub, opts["email"])
        profile = user.profile

        pilot_users = list(
            Profile.objects.filter(user__username__startswith=PILOT_PREFIX)
            .exclude(pk=profile.pk)
            .select_related("user")[:CONNECT_COUNT]
        )
        trips = list(Trip.objects.filter(owner__username__startswith=PILOT_PREFIX))

        if opts["undo"]:
            return self._undo(user, trips, pilot_users)

        if not trips:
            raise CommandError("No seeded trips found — run `python manage.py seed_pilot` first.")

        with transaction.atomic():
            # Make the demo user a usable traveller so Buddies can rank others.
            label, lat, lng = CITIES[0]
            Profile.objects.filter(pk=profile.pk).update(
                display_name=opts["name"] or profile.display_name or "Demo Traveller",
                onboarded=True,
                age_band=profile.age_band or "24-26",
                budget_style=profile.budget_style or "mid",
                daily_budget=profile.daily_budget or 2000,
                languages=profile.languages or ["english"],
                interests=profile.interests or ["food", "beaches", "hiking", "culture"],
                area_label=label,
                area_point=Point(
                    round(lng, COORDINATE_PRECISION), round(lat, COORDINATE_PRECISION), srid=4326
                ),
            )

            for trip in trips:
                TripCollaborator.objects.get_or_create(
                    trip=trip, user=user, defaults={"role": TripCollaborator.Role.EDITOR}
                )

            conns = []
            for pilot in pilot_users:
                conn, _ = Connection.objects.get_or_create(
                    requester=pilot.user,
                    addressee=user,
                    defaults={"status": Connection.Status.ACCEPTED},
                )
                if conn.status != Connection.Status.ACCEPTED:
                    conn.status = Connection.Status.ACCEPTED
                    conn.save(update_fields=["status"])
                conns.append((conn, pilot))

            # A starter message so the first thread isn't empty.
            if conns:
                conn, pilot = conns[0]
                if not conn.messages.exists():
                    Message.objects.create(
                        connection=conn,
                        sender=pilot.user,
                        body=f"Hi! I'm {pilot.display_name}. Want to plan a trip together? 🎒",
                    )

        self.stdout.write(
            self.style.SUCCESS(
                f"Attached {user.email or sub} to {len(trips)} trips and "
                f"{len(pilot_users)} buddy connections. Sign in and check Trips / Buddies / Messages."
            )
        )

    def _undo(self, user, trips, pilot_users):
        TripCollaborator.objects.filter(user=user, trip__in=trips).delete()
        Connection.objects.filter(
            requester__in=[p.user for p in pilot_users], addressee=user
        ).delete()  # cascades messages
        self.stdout.write(self.style.SUCCESS("Removed demo-user attachments."))
