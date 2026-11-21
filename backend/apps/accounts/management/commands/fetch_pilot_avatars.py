"""Fetch portrait photos of Indian travellers from Unsplash for the pilot data.

Two steps, because search results need a human eye before they become faces
in the app (many are elderly, crowd or landscape shots):

1. ``fetch_pilot_avatars --candidates`` searches the official Unsplash API and
   writes every result to data/pilot_avatar_candidates.json (gitignored-worthy
   scratch; one search request per query, no per-photo calls).
2. ``fetch_pilot_avatars --keep women=2,8,14 men=0,3`` copies the chosen
   candidates, in that order, into data/pilot_avatars.json — the committed file
   ``seed_pilot`` reads — and pings each chosen photo's download endpoint, as
   the Unsplash API guidelines ask when a photo is used.

Images are hotlinked from images.unsplash.com and each entry keeps the
photographer's name and profile for credit. Needs UNSPLASH_ACCESS_KEY in the
environment (a free key from https://unsplash.com/developers; a new app gets
50 requests an hour).
"""

import json
import os
from pathlib import Path

import requests
from django.core.management.base import BaseCommand, CommandError

API = "https://api.unsplash.com"
DATA = Path(__file__).resolve().parents[4] / "data"
OUT = DATA / "pilot_avatars.json"
CANDIDATES = DATA / "pilot_avatar_candidates.json"
# Pilot users are 18-35-ish travellers, so search for that, not "portrait"
# (which skews to elderly street portraiture).
QUERIES = {
    "women": [
        "young indian woman portrait",
        "indian woman smiling",
        "indian college girl",
        "indian woman traveller",
    ],
    "men": [
        "young indian man portrait",
        "indian man smiling",
        "indian college student boy",
        "indian man traveller",
    ],
}
# A square face crop at avatar size, served by Unsplash's image CDN.
CROP = "&w=256&h=256&fit=crop&crop=faces&q=80"
APP_NAME = "tripbuddy"


class Command(BaseCommand):
    help = "Fetch Indian portrait candidates from Unsplash, then keep chosen ones."

    def add_arguments(self, parser):
        parser.add_argument(
            "--candidates", action="store_true",
            help="Search Unsplash and write data/pilot_avatar_candidates.json.",
        )
        parser.add_argument(
            "--keep", nargs="+", metavar="KIND=I,J,...",
            help="Candidate indexes to keep per kind, e.g. women=0,4 men=2,3.",
        )

    def _session(self):
        key = os.environ.get("UNSPLASH_ACCESS_KEY", "").strip()
        if not key:
            raise CommandError("Set UNSPLASH_ACCESS_KEY (https://unsplash.com/developers).")
        session = requests.Session()
        session.headers.update({"Authorization": f"Client-ID {key}", "Accept-Version": "v1"})
        return session

    def handle(self, *args, **options):
        if options["candidates"]:
            return self._fetch_candidates()
        if options["keep"]:
            return self._keep(options["keep"])
        raise CommandError("Pass --candidates or --keep.")

    def _fetch_candidates(self):
        session = self._session()
        out = {}
        for kind, queries in QUERIES.items():
            photos, seen = [], set()
            for query in queries:
                resp = session.get(
                    f"{API}/search/photos",
                    params={
                        "query": query,
                        "per_page": 30,
                        "orientation": "portrait",
                        "content_filter": "high",
                    },
                    timeout=20,
                )
                if resp.status_code == 401:
                    raise CommandError("Unsplash rejected the access key (401).")
                if resp.status_code == 403:
                    raise CommandError("Unsplash rate limit reached; try again within the hour.")
                resp.raise_for_status()
                for photo in resp.json().get("results", []):
                    if photo["id"] in seen or photo.get("premium") or photo.get("plus"):
                        continue
                    seen.add(photo["id"])
                    user = photo["user"]
                    photos.append({
                        "id": photo["id"],
                        "url": photo["urls"]["raw"] + CROP,
                        "download_location": photo["links"]["download_location"],
                        "photographer": user["name"],
                        "profile": f"{user['links']['html']}?utm_source={APP_NAME}"
                                   "&utm_medium=referral",
                    })
            out[kind] = photos
            self.stdout.write(f"{kind}: {len(photos)} candidates")
        CANDIDATES.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
        self.stdout.write(self.style.SUCCESS(f"Wrote {CANDIDATES}"))

    def _keep(self, specs):
        candidates = json.loads(CANDIDATES.read_text(encoding="utf-8"))
        chosen = {"women": [], "men": []}
        for spec in specs:
            kind, _, idx = spec.partition("=")
            if kind not in chosen:
                raise CommandError(f"Unknown kind {kind!r}; use women= or men=.")
            chosen[kind] = [candidates[kind][int(i)] for i in idx.split(",") if i.strip()]

        # Best-effort download pings (guideline); a failure doesn't lose the pick.
        try:
            session = self._session()
        except CommandError:
            session = None
        pinged = 0
        for photos in chosen.values():
            for p in photos:
                if session is not None and p.get("download_location"):
                    try:
                        if session.get(p["download_location"], timeout=20).ok:
                            pinged += 1
                    except requests.RequestException:
                        pass

        result = {
            kind: [
                {"url": p["url"], "photographer": p["photographer"], "profile": p["profile"]}
                for p in photos
            ]
            for kind, photos in chosen.items()
        }
        OUT.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        self.stdout.write(self.style.SUCCESS(
            f"Wrote {OUT}: {len(result['women'])} women, {len(result['men'])} men "
            f"({pinged} download pings sent)"
        ))
