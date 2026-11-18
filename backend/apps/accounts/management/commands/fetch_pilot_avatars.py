"""Fetch portrait photos of Indian travellers from Unsplash for the pilot data.

Writes data/pilot_avatars.json — ``{"women": [...], "men": [...]}``, each entry
``{"url", "photographer", "profile"}`` — which ``seed_pilot`` reads to give each
fictitious traveller a face. Uses the official Unsplash API and follows its
guidelines: images are hotlinked from images.unsplash.com, each chosen photo's
download endpoint is pinged, and the photographer is credited in the JSON.

Needs UNSPLASH_ACCESS_KEY in the environment (a free key from
https://unsplash.com/developers). Network-bound, so it is a separate, explicit
step; the JSON is committed and seeding never calls Unsplash.
"""

import json
import os
from pathlib import Path

import requests
from django.core.management.base import BaseCommand, CommandError

API = "https://api.unsplash.com"
OUT = Path(__file__).resolve().parents[4] / "data" / "pilot_avatars.json"
QUERIES = {
    "women": "indian woman portrait",
    "men": "indian man portrait",
}
# A square face crop at avatar size, served by Unsplash's image CDN.
CROP = "&w=256&h=256&fit=crop&crop=faces&q=80"
APP_NAME = "tripbuddy"


class Command(BaseCommand):
    help = "Fetch Indian portrait photos from Unsplash into data/pilot_avatars.json."

    def add_arguments(self, parser):
        # ~60 pilot users split by first name, so 40 per gender is plenty.
        parser.add_argument("--per-gender", type=int, default=40)

    def _track(self, resp):
        try:
            self.remaining = int(resp.headers.get("X-Ratelimit-Remaining", self.remaining))
        except ValueError:
            pass

    def handle(self, *args, **options):
        key = os.environ.get("UNSPLASH_ACCESS_KEY", "").strip()
        if not key:
            raise CommandError("Set UNSPLASH_ACCESS_KEY (https://unsplash.com/developers).")
        session = requests.Session()
        session.headers.update({"Authorization": f"Client-ID {key}", "Accept-Version": "v1"})

        self.remaining = 50
        out = {}
        for kind, query in QUERIES.items():
            photos, seen, page = [], set(), 1
            while len(photos) < options["per_gender"] and page <= 5:
                resp = session.get(
                    f"{API}/search/photos",
                    params={
                        "query": query,
                        "page": page,
                        "per_page": 30,
                        "orientation": "portrait",
                        "content_filter": "high",
                    },
                    timeout=20,
                )
                self._track(resp)
                if resp.status_code == 401:
                    raise CommandError("Unsplash rejected the access key (401).")
                resp.raise_for_status()
                results = resp.json().get("results", [])
                if not results:
                    break
                for photo in results:
                    if photo["id"] in seen or photo.get("premium") or photo.get("plus"):
                        continue
                    seen.add(photo["id"])
                    # The Unsplash guidelines ask for this ping when a photo is
                    # used. Best-effort: a demo key has 50 requests/hour, so
                    # stop pinging before the searches themselves would fail.
                    if self.remaining > 5:
                        ping = session.get(photo["links"]["download_location"], timeout=20)
                        self._track(ping)
                    user = photo["user"]
                    photos.append({
                        "url": photo["urls"]["raw"] + CROP,
                        "photographer": user["name"],
                        "profile": f"{user['links']['html']}?utm_source={APP_NAME}"
                                   "&utm_medium=referral",
                    })
                    if len(photos) >= options["per_gender"]:
                        break
                page += 1
            out[kind] = photos
            self.stdout.write(f"{kind}: {len(photos)} photos")

        OUT.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
        self.stdout.write(self.style.SUCCESS(f"Wrote {OUT}"))
