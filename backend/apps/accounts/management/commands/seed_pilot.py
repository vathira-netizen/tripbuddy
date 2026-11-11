"""Fictitious pilot data for demonstrating TripBuddy.

Idempotent by construction, in two ways that matter:

* Every generated row is keyed on a deterministic identity — ``pilot-0007`` and
  a UUID derived from it — so re-running updates the same rows instead of
  creating a second cohort.
* The randomness is seeded from that same identity, so a given pilot user has
  the same interests and city on every run, on every machine. "Random" here
  means *varied*, not *different each time*; data that reshuffles under you is
  no use for a demo you have to narrate.

**Not for production.** These users have unusable passwords and no Supabase
Auth account, so nobody can sign in as them — but they are real rows that
appear in buddy search. The command refuses to run when ``DEBUG`` is off unless
``--force`` is passed, and ``--undo`` removes everything it made.
"""

import random
import uuid
from datetime import date, timedelta
from decimal import Decimal

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.geocoding import COORDINATE_PRECISION
from apps.accounts.models import Profile
from apps.budgets.models import BudgetItem
from apps.common.choices import (
    AGE_BAND_ORDER,
    BUDGET_TIER_ORDER,
    INTEREST_TAGS,
    LANGUAGES,
)
from apps.connections.models import Connection
from apps.destinations.models import Destination, SavedDestination
from apps.trips.models import ItineraryItem, Trip

User = get_user_model()

# Everything this command creates is prefixed with this, which is also how
# --undo finds it. Nothing else in the app uses the prefix.
PILOT_PREFIX = "pilot-"
PILOT_EMAIL_DOMAIN = "pilot.tripbuddy.invalid"

# A fixed namespace so supabase_user_id is stable across runs and machines.
PILOT_NAMESPACE = uuid.UUID("6f1c9a52-6c4e-4f4a-9a2f-2f7c1b0d4e11")

# Cities with a plausible spread across India, so proximity search has
# something to do. Stored rounded to the same precision as real onboarding
# (~1.1 km), because seeded rows must not be more precise than real ones.
CITIES = [
    ("Bengaluru, Karnataka", 12.97, 77.59),
    ("Mysuru, Karnataka", 12.30, 76.64),
    ("Chennai, Tamil Nadu", 13.08, 80.27),
    ("Kochi, Kerala", 9.93, 76.27),
    ("Hyderabad, Telangana", 17.39, 78.49),
    ("Mumbai, Maharashtra", 19.08, 72.88),
    ("Pune, Maharashtra", 18.52, 73.86),
    ("Delhi", 28.61, 77.21),
    ("Jaipur, Rajasthan", 26.91, 75.79),
    ("Kolkata, West Bengal", 22.57, 88.36),
    ("Ahmedabad, Gujarat", 23.02, 72.57),
    ("Guwahati, Assam", 26.14, 91.73),
]

FEMALE_NAMES = [
    "Asha", "Meera", "Priya", "Nithya", "Sneha", "Divya", "Ananya", "Ishita",
    "Lakshmi", "Neha", "Pooja", "Sara", "Tanvi",
]
MALE_NAMES = [
    "Ravi", "Arjun", "Karan", "Vikram", "Rohan", "Aditya", "Farhan", "Kabir",
    "Manish", "Omkar", "Rahul",
]
FIRST_NAMES = FEMALE_NAMES + MALE_NAMES

# Face photos for seeded profiles: randomuser.me's fixed portrait set (stable
# static URLs, 0-99 per gender). Fictitious people only; matched to the name's
# gender so a seeded "Asha" doesn't carry a man's face.
PORTRAIT_URL = "https://randomuser.me/api/portraits/{kind}/{n}.jpg"

LAST_NAMES = [
    "Nair", "Sharma", "Iyer", "Patel", "Reddy", "Menon", "Gupta", "Rao",
    "Desai", "Bose", "Khan", "Pillai",
]

TRIP_TITLES = [
    "Beach week", "Hill escape", "Heritage trail", "Backpacking loop",
    "Food crawl", "Monsoon getaway", "Wildlife safari", "Temple circuit",
    "Long weekend", "Coastal drive",
]

ITINERARY_IDEAS = [
    "Arrive and settle in", "Local market walk", "Sunrise viewpoint",
    "Museum visit", "Street food tour", "Boat ride", "Trek to the falls",
    "Beach afternoon", "Old town photo walk", "Cooking class",
    "Sunset point", "Travel home",
]

# Totals default to 100 records: 60 profiles + 25 connections + 15 trips.
DEFAULTS = {"profiles": 60, "connections": 25, "trips": 15}


class Command(BaseCommand):
    help = "Create (or refresh) fictitious pilot data for a demo. Dev projects only."

    def add_arguments(self, parser):
        parser.add_argument("--profiles", type=int, default=DEFAULTS["profiles"])
        parser.add_argument("--connections", type=int, default=DEFAULTS["connections"])
        parser.add_argument("--trips", type=int, default=DEFAULTS["trips"])
        parser.add_argument(
            "--force",
            action="store_true",
            help="Run even when DEBUG is off. Never do this on the real project.",
        )
        parser.add_argument(
            "--undo",
            action="store_true",
            help="Delete every pilot record instead of creating any.",
        )

    def handle(self, *args, **options):
        if not settings.DEBUG and not options["force"]:
            raise CommandError(
                "Refusing to run with DEBUG off. This writes fictitious users into "
                "whatever database DATABASE_URL points at. Pass --force only if you "
                "are certain that is a dev project."
            )

        if options["undo"]:
            return self._undo()

        counts = {k: max(0, options[k]) for k in DEFAULTS}
        total = sum(counts.values())
        if total > 100:
            raise CommandError(
                f"{total} records requested; the pilot dataset is capped at 100. "
                "Lower --profiles/--connections/--trips."
            )
        if counts["profiles"] < 2 and counts["connections"]:
            raise CommandError("Connections need at least 2 profiles.")

        with transaction.atomic():
            profiles = self._seed_profiles(counts["profiles"])
            connections = self._seed_connections(profiles, counts["connections"])
            trips = self._seed_trips(profiles, counts["trips"])

        self.stdout.write(
            self.style.SUCCESS(
                f"Pilot data ready: {len(profiles)} profiles, {len(connections)} "
                f"connections, {len(trips)} trips ({total} records). "
                "Re-running is safe; `--undo` removes them."
            )
        )

    # -- profiles ----------------------------------------------------------

    def _seed_profiles(self, count):
        profiles = []
        for index in range(count):
            handle = f"{PILOT_PREFIX}{index:04d}"
            rng = random.Random(handle)  # deterministic per pilot user

            user, _ = User.objects.get_or_create(
                username=handle,
                defaults={"email": f"{handle}@{PILOT_EMAIL_DOMAIN}"},
            )
            if user.has_usable_password():
                # Nobody signs in as a pilot user; there is no Supabase account.
                user.set_unusable_password()
                user.save(update_fields=["password"])

            label, lat, lng = rng.choice(CITIES)
            # Jitter within roughly the same city, then round to the same
            # precision real onboarding stores.
            lat = round(lat + rng.uniform(-0.05, 0.05), COORDINATE_PRECISION)
            lng = round(lng + rng.uniform(-0.05, 0.05), COORDINATE_PRECISION)

            first = rng.choice(FIRST_NAMES)
            female = first in FEMALE_NAMES
            name = f"{first} {rng.choice(LAST_NAMES)}"
            avatar_url = PORTRAIT_URL.format(
                kind="women" if female else "men", n=rng.randint(0, 99)
            )
            interests = rng.sample(INTEREST_TAGS, rng.randint(3, 6))
            languages = rng.sample(LANGUAGES, rng.randint(1, 3))
            if "english" not in languages and rng.random() < 0.7:
                languages.append("english")

            profile, _ = Profile.objects.update_or_create(
                user=user,
                defaults={
                    # uuid5 keeps the id stable across runs and machines.
                    "supabase_user_id": uuid.uuid5(PILOT_NAMESPACE, handle),
                    "display_name": name,
                    "age_band": rng.choice(AGE_BAND_ORDER),
                    "gender": "female" if female else "male",
                    "avatar_url": avatar_url,
                    "languages": sorted(languages),
                    "interests": sorted(interests),
                    "budget_style": rng.choice(BUDGET_TIER_ORDER),
                    "daily_budget": rng.choice([800, 1200, 1500, 2000, 2500, 3500, 5000]),
                    "area_label": label,
                    "area_point": Point(lng, lat, srid=4326),
                    "onboarded": True,
                },
            )
            profiles.append(profile)

            self._seed_saved_destinations(profile, rng)

        return profiles

    def _seed_saved_destinations(self, profile, rng):
        """A few saved destinations, so the shared-destination boost has data."""
        destinations = list(Destination.objects.order_by("id").values_list("id", flat=True))
        if not destinations:
            return
        for destination_id in rng.sample(
            destinations, min(len(destinations), rng.randint(0, 3))
        ):
            SavedDestination.objects.get_or_create(
                user=profile.user, destination_id=destination_id
            )

    # -- connections -------------------------------------------------------

    def _seed_connections(self, profiles, count):
        """A spread of states so the UI shows accepted, pending and blocked."""
        if count == 0 or len(profiles) < 2:
            return []

        rng = random.Random("pilot-connections")
        states = (
            [Connection.Status.ACCEPTED] * max(1, count // 2)
            + [Connection.Status.PENDING] * max(1, count // 3)
            + [Connection.Status.DECLINED, Connection.Status.BLOCKED]
        )

        connections = []
        seen = set()
        attempts = 0
        while len(connections) < count and attempts < count * 20:
            attempts += 1
            a, b = rng.sample(range(len(profiles)), 2)
            # One row per unordered pair: the model's unique_together is
            # ordered, so normalise here or a re-run creates the mirror image.
            key = (min(a, b), max(a, b))
            if key in seen:
                continue
            seen.add(key)

            requester = profiles[key[0]].user
            addressee = profiles[key[1]].user
            status = states[len(connections) % len(states)]

            connection, _ = Connection.objects.update_or_create(
                requester=requester,
                addressee=addressee,
                defaults={
                    "status": status,
                    "blocked_by": requester if status == Connection.Status.BLOCKED else None,
                },
            )
            connections.append(connection)

        return connections

    # -- trips -------------------------------------------------------------

    def _seed_trips(self, profiles, count):
        if count == 0 or not profiles:
            return []

        destinations = list(Destination.objects.order_by("id"))
        today = date.today()
        trips = []

        for index in range(count):
            handle = f"{PILOT_PREFIX}trip-{index:03d}"
            rng = random.Random(handle)
            owner = profiles[index % len(profiles)].user

            start = today + timedelta(days=rng.randint(-30, 90))
            nights = rng.randint(2, 9)
            destination = rng.choice(destinations) if destinations else None
            title = f"{rng.choice(TRIP_TITLES)}"
            if destination:
                title = f"{title} in {destination.name}"

            trip, _ = Trip.objects.update_or_create(
                owner=owner,
                title=title,
                defaults={
                    "destination": destination,
                    "start_date": start,
                    "end_date": start + timedelta(days=nights),
                    "target_amount": Decimal(rng.choice([8000, 12000, 20000, 35000])),
                },
            )
            trips.append(trip)

            self._seed_itinerary(trip, nights, rng)
            self._seed_budget(trip, nights, rng)

        return trips

    def _seed_itinerary(self, trip, nights, rng):
        # Replace rather than append: re-running must not grow the itinerary.
        ItineraryItem.objects.filter(trip=trip).delete()
        for day in range(min(nights, 5)):
            for position, title in enumerate(
                rng.sample(ITINERARY_IDEAS, rng.randint(1, 3))
            ):
                ItineraryItem.objects.create(
                    trip=trip,
                    day_index=day,
                    position=position,
                    title=title,
                    notes="",
                )

    def _seed_budget(self, trip, nights, rng):
        BudgetItem.objects.filter(trip=trip).delete()
        for category in BudgetItem.Category.values:
            if rng.random() < 0.25:
                continue  # not every trip has every category
            BudgetItem.objects.create(
                trip=trip,
                category=category,
                label=f"{category} for {nights} nights",
                amount=Decimal(rng.randrange(500, 12000, 100)),
                payer=trip.owner,
            )

    # -- undo --------------------------------------------------------------

    def _undo(self):
        users = User.objects.filter(username__startswith=PILOT_PREFIX)
        count = users.count()
        # Deleting the users cascades profiles, connections, trips, itinerary
        # items, budget items and saved destinations.
        deleted = users.delete()
        self.stdout.write(
            self.style.SUCCESS(
                f"Removed {count} pilot users and everything they owned: {deleted}"
            )
        )
