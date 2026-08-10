"""Tunable inputs to the buddy-matching score (Phase 4).

These are the starting values for the two open items:

* **TBD-1 — component weights.** ``WEIGHTS`` below. Every component scores a
  candidate on 0.0–1.0; the final match score is the weighted sum, so the
  weights must total 1.0 and the score is itself always 0.0–1.0. That property
  is what makes the number presentable as a percentage in the UI, and it is
  enforced by ``validate_weights()`` (and asserted in tests) rather than left to
  care.
* **TBD-3 — default search radius.** ``DEFAULT_RADIUS_KM`` below.

Both are expected to move once there is real profile data to tune against, so
they live here — one module, no logic — instead of being scattered through the
scoring code. The radius is additionally overridable per environment
(``MATCH_DEFAULT_RADIUS_KM``) so it can be adjusted without a code deploy.

Rationale for the starting split, in case a later tuner wants to know what the
first guess assumed:

* ``interests`` leads because a shared reason to travel is the thing users
  self-report most reliably, and the tag vocabulary is shared with the
  destination catalogue (see ``apps.common.choices.INTEREST_TAGS``).
* ``budget`` and ``proximity`` are joint second: this is a budget-first product,
  and two people who cannot meet before the trip rarely book together.
* ``languages`` matters in the Indian market the seed catalogue targets, but a
  common language (usually English or Hindi) is frequent enough that it
  separates candidates less than interests do.
* ``age_band`` is a mild preference, not a filter — deliberately low so it
  nudges rather than segregates.
* ``shared_destinations`` is the smallest term on purpose. It is a *boost*: a
  strong positive signal when present, but most new users have saved nothing, so
  a large weight would mostly penalise newcomers for an empty list.
"""

from django.conf import settings

from apps.matching.compatibility import COMPONENT_WEIGHT_KEYS, WEIGHTS

__all__ = [
    "WEIGHTS",
    "DEFAULT_RADIUS_KM",
    "MIN_RADIUS_KM",
    "MAX_RADIUS_KM",
    "validate_weights",
    "default_radius_km",
    "clamp_radius_km",
]

# TBD-1 lives with the scoring functions it parameterises, in
# apps/matching/compatibility.py, and is re-exported here so that the tunables
# and their validation stay documented in one place.

# TBD-3. Default radius for "travellers near me", in kilometres.
#
# Profile points are city centres, never device locations, so this is a
# city-to-city distance: 150 km keeps a metro and its neighbouring cities in
# range (Bengaluru-Mysuru, Delhi-Jaipur) without collapsing into a single
# city's users, which would leave sparse regions with no candidates at all.
DEFAULT_RADIUS_KM = 150

# Bounds for a caller-supplied ?radius_km=. The maximum is a guard against a
# query that would scan the whole table, not a product limit.
MIN_RADIUS_KM = 1
MAX_RADIUS_KM = 2000

# Beyond this, proximity contributes nothing. Candidates further out can still
# match on the other components, so this is a score floor and not a filter.
PROXIMITY_FALLOFF_KM = DEFAULT_RADIUS_KM


def validate_weights(weights=None):
    """Raise ``ValueError`` unless the weights form a usable distribution.

    Called by ``MatchingConfig.ready()`` so a mistuned deploy fails at startup
    rather than silently returning scores that cannot reach 1.0.
    """
    weights = WEIGHTS if weights is None else weights

    if not weights:
        raise ValueError("Matching weights are empty.")

    negative = sorted(k for k, v in weights.items() if v < 0)
    if negative:
        raise ValueError(f"Matching weights must not be negative: {negative}.")

    # Every component the scoring code iterates must have a weight; a missing
    # one would silently drop that component out of the score.
    if weights is WEIGHTS:
        missing = sorted(set(COMPONENT_WEIGHT_KEYS.values()) - set(weights))
        if missing:
            raise ValueError(f"Matching weights are missing components: {missing}.")

    total = sum(weights.values())
    # Tolerance covers binary float representation only, not sloppy tuning.
    if abs(total - 1.0) > 1e-9:
        raise ValueError(
            f"Matching weights must sum to 1.0, got {total!r} "
            f"from {sorted(weights)}."
        )
    return True


def default_radius_km():
    """The configured default radius, clamped to the supported bounds."""
    value = getattr(settings, "MATCH_DEFAULT_RADIUS_KM", DEFAULT_RADIUS_KM)
    return clamp_radius_km(value)


def clamp_radius_km(value):
    """Clamp a radius (e.g. from a query parameter) into the supported range."""
    return max(MIN_RADIUS_KM, min(int(value), MAX_RADIUS_KM))
