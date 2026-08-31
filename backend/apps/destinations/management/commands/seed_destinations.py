"""Load the curated destination catalogue from a CSV.

Idempotent: upserts on ``slug`` so re-running never creates duplicates. The
interest tags are validated against the shared ``INTEREST_TAGS`` vocabulary so
they stay in lockstep with profile tags (a mismatch would silently break the
Phase 4 matching boost).
"""

import csv
from pathlib import Path

from django.contrib.gis.geos import Point
from django.core.management.base import BaseCommand, CommandError

from apps.common.choices import BudgetTier, INTEREST_TAGS

DEFAULT_CSV = Path(__file__).resolve().parents[4] / "data" / "destination_seed.csv"
VALID_TIERS = {t.value for t in BudgetTier}
VALID_TAGS = set(INTEREST_TAGS)


class Command(BaseCommand):
    help = "Upsert the destination catalogue from data/destination_seed.csv"

    def add_arguments(self, parser):
        parser.add_argument("--csv", default=str(DEFAULT_CSV))

    def handle(self, *args, **options):
        from apps.destinations.models import Destination

        path = Path(options["csv"])
        if not path.exists():
            raise CommandError(f"CSV not found: {path}")

        created = updated = 0
        with path.open(encoding="utf-8") as fh:
            for lineno, row in enumerate(csv.DictReader(fh), start=2):
                tags = [t.strip().lower() for t in row["interest_tags"].split("|") if t.strip()]
                bad = set(tags) - VALID_TAGS
                if bad:
                    raise CommandError(f"Line {lineno}: unknown interest tags {sorted(bad)}")
                if row["budget_tier"] not in VALID_TIERS:
                    raise CommandError(f"Line {lineno}: unknown budget_tier '{row['budget_tier']}'")

                # Point(x=lng, y=lat) — GeoDjango takes longitude first.
                point = Point(float(row["lng"]), float(row["lat"]), srid=4326)
                _, was_created = Destination.objects.update_or_create(
                    slug=row["slug"].strip(),
                    defaults={
                        "name": row["name"].strip(),
                        "point": point,
                        "avg_daily_budget": int(row["avg_daily_budget"]),
                        "budget_tier": row["budget_tier"],
                        "interest_tags": tags,
                        "best_season": row.get("best_season", "").strip(),
                        "region": row.get("region", "").strip(),
                        "image_url": row.get("image_url", "").strip(),
                        # Gallery extras beyond the card thumbnail above, same
                        # deterministic placeholder convention, distinct seeds.
                        "image_urls": [
                            f"https://picsum.photos/seed/{row['slug'].strip()}-{n}/900/600"
                            for n in (2, 3, 4)
                        ],
                    },
                )
                created += was_created
                updated += not was_created

        self.stdout.write(
            self.style.SUCCESS(f"Seeded destinations: {created} created, {updated} updated")
        )
