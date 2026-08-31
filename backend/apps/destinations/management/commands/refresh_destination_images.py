"""One-off refresh of Destination.image_url / image_urls from real photos.

The seed data's placeholder host (picsum.photos) is unreachable from this
environment — that's the actual cause of "broken images" on /discover, not a
frontend bug. This pulls real, freely-licensed photos from Wikipedia/Wikimedia
Commons instead, keyed off each destination's name.

Not part of ``seed_destinations`` (which stays CSV-driven and side-effect-free
against the network) — this is a separate, explicit, re-runnable refresh.
"""

import logging
import time

import requests
from django.conf import settings
from django.core.management.base import BaseCommand

logger = logging.getLogger(__name__)

SUMMARY_URL = "https://en.wikipedia.org/api/rest_v1/page/summary/{title}"
ACTION_API = "https://en.wikipedia.org/w/api.php"
TIMEOUT = 10
MAX_RETRIES = 4
# Between destinations, not between the two calls a single destination makes —
# Wikimedia's rate limit is what a burst of 36 back-to-back lookups hit.
PACE_SECONDS = 1.0


def _get_with_retry(url, **kwargs):
    """A 429-respecting GET — retries with the server's own Retry-After, then
    exponential backoff if it didn't send one."""
    for attempt in range(MAX_RETRIES):
        response = requests.get(url, timeout=TIMEOUT, **kwargs)
        if response.status_code != 429:
            return response
        wait = float(response.headers.get("Retry-After", 2 ** attempt))
        logger.info("Rate limited, waiting %ss (attempt %d)", wait, attempt + 1)
        time.sleep(wait)
    return response

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
    ".svg",
    "commons-logo",
    "wiktionary",
    "wikinews",
    "disambig",
)


class Command(BaseCommand):
    help = "Refresh Destination.image_url / image_urls from Wikipedia/Wikimedia Commons."

    def add_arguments(self, parser):
        parser.add_argument("--gallery-size", type=int, default=3)

    def handle(self, *args, **options):
        from apps.destinations.models import Destination

        gallery_size = options["gallery_size"]
        updated = skipped = 0
        destinations = list(Destination.objects.all())

        for i, dest in enumerate(destinations):
            if i > 0:
                time.sleep(PACE_SECONDS)
            try:
                hero, gallery = self._fetch(dest.name, gallery_size)
            except requests.RequestException as exc:
                logger.warning("Image lookup failed for %s: %s", dest.name, exc)
                skipped += 1
                continue

            if not hero:
                logger.warning("No Wikipedia photo found for %s", dest.name)
                skipped += 1
                continue

            dest.image_url = hero
            dest.image_urls = gallery
            dest.save(update_fields=["image_url", "image_urls"])
            updated += 1

        self.stdout.write(
            self.style.SUCCESS(f"Refreshed images: {updated} updated, {skipped} skipped")
        )

    def _fetch(self, name: str, gallery_size: int) -> tuple[str, list[str]]:
        data = self._summary(name)
        # A short/common place name (Gokarna, Manali, ...) often lands on a
        # Wikipedia disambiguation page with no photo — ", India" resolves it
        # to the actual town almost every time, since every destination here
        # is Indian.
        if data is None or data.get("type") == "disambiguation" or not self._hero(data):
            data = self._summary(f"{name}, India") or data

        if data is None:
            return "", []
        hero = self._hero(data)
        if not hero:
            return "", []

        gallery = self._gallery(data.get("title", name), gallery_size, exclude=hero)
        return hero, gallery

    def _summary(self, name: str) -> dict | None:
        # Wikimedia rejects requests with no identifying User-Agent (its API
        # etiquette policy) — reuses the same contact string already used for
        # Nominatim (apps.accounts.geocoding), no new setting needed.
        response = _get_with_retry(
            SUMMARY_URL.format(title=requests.utils.quote(name)),
            headers={"User-Agent": settings.NOMINATIM_USER_AGENT},
        )
        if response.status_code != 200:
            logger.warning("Wikipedia summary for %r returned %s", name, response.status_code)
            return None
        return response.json()

    @staticmethod
    def _hero(data: dict | None) -> str:
        if not data:
            return ""
        return (data.get("originalimage") or data.get("thumbnail") or {}).get("source", "")

    def _gallery(self, page_title: str, size: int, *, exclude: str) -> list[str]:
        if size <= 0:
            return []
        headers = {"User-Agent": settings.NOMINATIM_USER_AGENT}
        try:
            images = _get_with_retry(
                ACTION_API,
                params={
                    "action": "query",
                    "titles": page_title,
                    "prop": "images",
                    "imlimit": 40,
                    "format": "json",
                },
                headers=headers,
            ).json()
        except requests.RequestException:
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
                params={
                    "action": "query",
                    "titles": "|".join(titles),
                    "prop": "imageinfo",
                    "iiprop": "url",
                    "iiurlwidth": 900,
                    "format": "json",
                },
                headers=headers,
            ).json()
        except requests.RequestException:
            return []

        urls = []
        for page in info.get("query", {}).get("pages", {}).values():
            for entry in page.get("imageinfo", []):
                url = entry.get("thumburl") or entry.get("url")
                if url and url != exclude:
                    urls.append(url)
        return urls[:size]
