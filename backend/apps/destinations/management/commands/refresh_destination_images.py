"""Fill the seed CSV's photo columns from Wikipedia/Wikimedia Commons.

Writes ``image_url`` (hero), ``image_urls`` (gallery, ``|``-separated) and
``image_credit`` (the Wikipedia page the photos come from — Commons licences
require credit) into data/destination_seed.csv. ``seed_destinations`` then
loads them, so the CSV stays the single source of truth and re-seeding never
wipes the photos. Network-bound and slow (rate-limit friendly), so it is a
separate, explicit step rather than part of seeding.
"""

import csv
import logging
import re
import time
from pathlib import Path

import requests
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

logger = logging.getLogger(__name__)

DEFAULT_CSV = Path(__file__).resolve().parents[4] / "data" / "destination_seed.csv"
SUMMARY_URL = "https://en.wikipedia.org/api/rest_v1/page/summary/{title}"
ACTION_API = "https://en.wikipedia.org/w/api.php"
TIMEOUT = 10
MAX_RETRIES = 4
HERO_WIDTH = 1280
# Between destinations — Wikimedia's rate limit is what a burst of
# back-to-back lookups hits.
PACE_SECONDS = 1.0

# Catalogue names whose Wikipedia article has a different title.
WIKI_TITLES = {
    "alleppey": "Alappuzha",
    "andaman": "Radhanagar Beach",
    "mahabalipuram": "Shore Temple",
    "coorg": "Kodagu district",
    "nubra-valley": "Nubra Valley",
    "bir-billing": "Bir, Himachal Pradesh",
    "ooty": "Ooty",
    "jim-corbett": "Jim Corbett National Park",
    "valley-of-flowers": "Valley of Flowers National Park",
    "gir": "Gir National Park",
    "diu": "Diu, India",
    "bandhavgarh": "Bandhavgarh National Park",
    "cherrapunji": "Sohra",
    "rann-of-kutch": "Rann of Kutch",
    "pondicherry": "Puducherry",
    "mysore": "Mysore Palace",
    "ranthambore": "Ranthambore National Park",
    "tirthan-valley": "Great Himalayan National Park",
}

# Wikipedia pages carry flags/logos/maps/icons alongside real photos in their
# image list; these substrings almost always mean "not a destination photo".
SKIP_SUBSTRINGS = (
    "flag of",
    "logo",
    "icon",
    "symbol",
    "coat of arms",
    "locator map",
    "location map",
    "map",
    ".svg",
    ".gif",
    "commons-logo",
    "wiktionary",
    "wikinews",
    "disambig",
)

HEADERS = {"User-Agent": settings.NOMINATIM_USER_AGENT}


def _get_with_retry(url, **kwargs):
    """A 429-respecting GET — retries with the server's own Retry-After, then
    exponential backoff if it didn't send one."""
    for attempt in range(MAX_RETRIES):
        response = requests.get(url, timeout=TIMEOUT, headers=HEADERS, **kwargs)
        if response.status_code != 429:
            return response
        wait = float(response.headers.get("Retry-After", 2 ** attempt))
        logger.info("Rate limited, waiting %ss (attempt %d)", wait, attempt + 1)
        time.sleep(wait)
    return response


class Command(BaseCommand):
    help = "Write Wikimedia photo URLs and credits into the destination seed CSV."

    def add_arguments(self, parser):
        parser.add_argument("--csv", default=str(DEFAULT_CSV))
        parser.add_argument("--gallery-size", type=int, default=3)
        parser.add_argument(
            "--all", action="store_true", help="Refetch rows that already have a photo."
        )

    def handle(self, *args, **options):
        path = Path(options["csv"])
        if not path.exists():
            raise CommandError(f"CSV not found: {path}")
        with path.open(encoding="utf-8", newline="") as fh:
            reader = csv.DictReader(fh)
            fields = reader.fieldnames
            rows = list(reader)
        missing = {"image_url", "image_urls", "image_credit"} - set(fields)
        if missing:
            raise CommandError(f"CSV is missing columns: {sorted(missing)}")

        updated = skipped = 0
        for row in rows:
            if row["image_url"] and not options["all"]:
                continue
            title = WIKI_TITLES.get(row["slug"], row["name"])
            try:
                hero, gallery, credit = self._fetch(title, options["gallery_size"])
            except requests.RequestException as exc:
                logger.warning("Image lookup failed for %s: %s", row["name"], exc)
                hero = ""
            if not hero:
                self.stdout.write(self.style.WARNING(f"No photo found for {row['name']}"))
                skipped += 1
            else:
                row["image_url"], row["image_urls"], row["image_credit"] = hero, "|".join(gallery), credit
                updated += 1
                # Save as we go so an interrupted run keeps what it fetched.
                self._write(path, fields, rows)
            time.sleep(PACE_SECONDS)

        self.stdout.write(self.style.SUCCESS(f"Photos: {updated} updated, {skipped} not found"))

    @staticmethod
    def _write(path, fields, rows):
        with path.open("w", encoding="utf-8", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=fields, lineterminator="\r\n")
            writer.writeheader()
            writer.writerows(rows)

    def _fetch(self, title: str, gallery_size: int) -> tuple[str, list[str], str]:
        data = self._summary(title)
        # Short place names often land on a disambiguation page with no photo;
        # ", India" resolves it to the actual place almost every time.
        if data is None or data.get("type") == "disambiguation" or not self._hero(data):
            data = self._summary(f"{title}, India") or data
        hero = self._hero(data)
        if not hero:
            return "", [], ""
        credit = data.get("content_urls", {}).get("desktop", {}).get("page", "")
        gallery = self._gallery(data.get("title", title), gallery_size, exclude=hero)
        return hero, gallery, credit

    def _summary(self, title: str) -> dict | None:
        response = _get_with_retry(SUMMARY_URL.format(title=requests.utils.quote(title)))
        if response.status_code != 200:
            return None
        return response.json()

    @staticmethod
    def _hero(data: dict | None) -> str:
        """A ~1280px rendition of the article's lead photo (originals can be
        tens of megabytes)."""
        if not data or not data.get("thumbnail"):
            return ""
        thumb = data["thumbnail"]["source"].split("?")[0]
        if (data.get("originalimage") or {}).get("width", 0) > HERO_WIDTH:
            return re.sub(r"/\d+px-", f"/{HERO_WIDTH}px-", thumb)
        return (data.get("originalimage") or {}).get("source", thumb).split("?")[0]

    def _gallery(self, page_title: str, size: int, *, exclude: str) -> list[str]:
        if size <= 0:
            return []
        try:
            images = _get_with_retry(
                ACTION_API,
                params={"action": "query", "titles": page_title, "prop": "images",
                        "imlimit": 40, "format": "json"},
            ).json()
        except (requests.RequestException, ValueError):
            return []

        pages = images.get("query", {}).get("pages", {})
        titles = [
            img["title"]
            for page in pages.values()
            for img in page.get("images", [])
            if not any(s in img["title"].lower() for s in SKIP_SUBSTRINGS)
        ][: size * 2]  # a few extra in case some fail to resolve
        if not titles:
            return []

        try:
            info = _get_with_retry(
                ACTION_API,
                params={"action": "query", "titles": "|".join(titles), "prop": "imageinfo",
                        "iiprop": "url", "iiurlwidth": 900, "format": "json"},
            ).json()
        except (requests.RequestException, ValueError):
            return []

        hero_file = exclude.rsplit("/", 1)[-1].split("px-", 1)[-1]
        urls = []
        for page in info.get("query", {}).get("pages", {}).values():
            for entry in page.get("imageinfo", []):
                url = entry.get("thumburl") or entry.get("url")
                if url and hero_file not in url:
                    urls.append(url)
        return urls[:size]
