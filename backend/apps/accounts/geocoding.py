"""City geocoding via Nominatim / OpenStreetMap.

Privacy: we geocode the *city name a user typed*, never a device location, and
we deliberately round the result before storing it. A city centroid rounded to
2 decimal places is accurate to roughly a kilometre — plenty for "buddies within
25 km" scoring, useless for locating anyone.
"""

import logging

import requests
from django.conf import settings
from django.contrib.gis.geos import Point

logger = logging.getLogger(__name__)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
TIMEOUT_SECONDS = 8

# ~1.1 km of precision. Never store finer than this.
COORDINATE_PRECISION = 2


class GeocodingError(Exception):
    """The city could not be resolved to a point."""


def geocode_city(query):
    """Resolve a free-text city to ``(Point, canonical_label)``.

    Raises ``GeocodingError`` if the service is unreachable or finds nothing.
    """

    query = (query or "").strip()
    if not query:
        raise GeocodingError("No city given.")

    try:
        response = requests.get(
            NOMINATIM_URL,
            params={
                "q": query,
                "format": "jsonv2",
                "limit": 1,
                "addressdetails": 0,
                # Cities, towns, villages and states — not house numbers.
                "featureType": "settlement",
            },
            headers={"User-Agent": settings.NOMINATIM_USER_AGENT},
            timeout=TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        results = response.json()
    except (requests.RequestException, ValueError) as exc:
        logger.warning("Nominatim lookup failed for %r: %s", query, exc)
        raise GeocodingError("Could not reach the geocoding service.") from exc

    if not results:
        raise GeocodingError(f"No place found for {query!r}.")

    top = results[0]
    try:
        lat = round(float(top["lat"]), COORDINATE_PRECISION)
        lng = round(float(top["lon"]), COORDINATE_PRECISION)
    except (KeyError, TypeError, ValueError) as exc:
        raise GeocodingError("Geocoding service returned an unusable result.") from exc

    label = top.get("display_name") or query
    # GeoDjango is Point(x=lng, y=lat) — the opposite order to the API response.
    return Point(lng, lat, srid=4326), label[:120]
