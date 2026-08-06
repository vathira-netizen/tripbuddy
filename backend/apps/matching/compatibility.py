"""Traveller compatibility scoring — pure functions, no database, no model.

The score is a transparent weighted sum of six components, each normalised to
0.0–1.0 before weighting:

===========  ==============================================================
 ``G``       Geographic proximity, from a PostGIS-measured distance.
 ``J``       Jaccard overlap of interest tags.
 ``B``       Budget-style agreement, with partial credit for adjacent tiers.
 ``L``       Jaccard overlap of spoken languages.
 ``A``       Age-band agreement (exact, adjacent, or neither).
 ``D``       Shared target destination — a boost, present or absent.
===========  ==============================================================

Nothing here touches the ORM: every function takes plain values, so the whole
scoring rule is unit-testable without a database and can be reasoned about by
reading one file. ``apps.matching.services`` is what fetches the inputs.

Two deliberate properties:

* **Missing data scores zero, never raises.** A profile with no ``area_point``,
  no interests or a blank ``budget_style`` is scored as incompatible on that
  component rather than crashing or being silently excluded — half-finished
  profiles are normal.
* **The weights sum to 1.0**, so the weighted sum is itself 0.0–1.0 and
  ``combine`` can present it as a plain 0–100 percentage. This is enforced at
  startup by ``apps.matching.constants.validate_weights``.
"""

from apps.common.choices import AGE_BAND_ORDER, BUDGET_TIER_ORDER

# TBD-1 — the tunable component weights. See apps/matching/constants.py for the
# rationale behind this split and the startup validation that guards it.
WEIGHTS = {
    "wJ": 0.30,  # interests
    "wG": 0.20,  # proximity
    "wB": 0.20,  # budget style
    "wL": 0.15,  # languages
    "wA": 0.10,  # age band
    "wD": 0.05,  # shared destination
}

# Component key -> weight key. Also fixes the canonical component order.
COMPONENT_WEIGHT_KEYS = {
    "G": "wG",
    "J": "wJ",
    "B": "wB",
    "L": "wL",
    "A": "wA",
    "D": "wD",
}

COMPONENTS = tuple(COMPONENT_WEIGHT_KEYS)

# Human-readable chip labels, used by explain(). Kept next to the components so
# adding a component without a label is immediately obvious.
COMPONENT_LABELS = {
    "G": "Nearby",
    "J": "Shared interests",
    "B": "Similar budget",
    "L": "Common language",
    "A": "Similar age",
    "D": "Wants the same place",
}

# Components that explain() always surfaces when they score above the
# threshold, ahead of filling the remaining slots by contribution.
#
# ``D`` is pinned because weight and informativeness diverge for it. It carries
# the smallest weight — deliberately, since most users have saved nothing — so
# it can never win a contribution ranking, yet it is the only component that
# reports a concrete shared *intention* ("you both want to go to Goa") rather
# than a similarity of attributes. Left unpinned it would be true of the score
# and invisible in the explanation.
PINNED_COMPONENTS = ("D",)


def clamp(value, low=0.0, high=1.0):
    """Constrain ``value`` to ``[low, high]``."""
    return max(low, min(float(value), high))


def proximity(distance_m, radius_m):
    """``G`` — 1.0 at zero distance, falling linearly to 0.0 at the radius.

    ``distance_m`` is ``None`` when either traveller has no ``area_point``; that
    is unknown rather than far, but it cannot be scored, so it contributes
    nothing. A non-positive radius would make the ratio meaningless, so it is
    treated the same way.
    """
    if distance_m is None or radius_m is None:
        return 0.0
    distance_m = float(distance_m)
    radius_m = float(radius_m)
    if radius_m <= 0 or distance_m < 0:
        return 0.0
    return clamp(1.0 - distance_m / radius_m)


def jaccard(a, b):
    """|A ∩ B| / |A ∪ B|, with an empty union scoring 0.0 rather than dividing by zero.

    Values are compared case-insensitively so that a profile saved before the
    serializer started lower-casing tags still matches.
    """
    set_a = _normalise(a)
    set_b = _normalise(b)
    union = set_a | set_b
    if not union:
        return 0.0
    return len(set_a & set_b) / len(union)


def interests(interests_a, interests_b):
    """``J`` — interest-tag overlap."""
    return jaccard(interests_a, interests_b)


def languages(languages_a, languages_b):
    """``L`` — spoken-language overlap."""
    return jaccard(languages_a, languages_b)


def budget(style_a, style_b, tier_order=BUDGET_TIER_ORDER):
    """``B`` — 1.0 for the same style, partial credit by distance along the tiers.

    With the three tiers budget/mid/comfort that is 1.0 for a match, 0.5 for
    neighbours (budget↔mid, mid↔comfort) and 0.0 for the extremes. A blank style
    — the profile default before onboarding — scores 0.0.
    """
    a = _clean(style_a)
    b = _clean(style_b)
    if not a or not b:
        return 0.0
    order = list(tier_order)
    if a not in order or b not in order:
        return 0.0
    if a == b:
        return 1.0
    span = len(order) - 1
    if span <= 0:
        return 1.0
    return clamp(1.0 - abs(order.index(a) - order.index(b)) / span)


def age(band_a, band_b, band_order=AGE_BAND_ORDER):
    """``A`` — 1.0 for the same band, 0.5 for an adjacent one, 0.0 otherwise."""
    a = _clean(band_a)
    b = _clean(band_b)
    if not a or not b:
        return 0.0
    order = list(band_order)
    if a not in order or b not in order:
        return 0.0
    gap = abs(order.index(a) - order.index(b))
    if gap == 0:
        return 1.0
    if gap == 1:
        return 0.5
    return 0.0


def destination(destination_ids_a, destination_ids_b):
    """``D`` — 1.0 if the two travellers target at least one destination in common."""
    set_a = {d for d in (destination_ids_a or []) if d is not None}
    set_b = {d for d in (destination_ids_b or []) if d is not None}
    return 1.0 if set_a & set_b else 0.0


def score_parts(
    *,
    distance_m,
    radius_m,
    interests_a,
    interests_b,
    budget_style_a,
    budget_style_b,
    languages_a,
    languages_b,
    age_band_a,
    age_band_b,
    destination_ids_a,
    destination_ids_b,
):
    """Every component score for one pair, keyed by component letter."""
    return {
        "G": proximity(distance_m, radius_m),
        "J": interests(interests_a, interests_b),
        "B": budget(budget_style_a, budget_style_b),
        "L": languages(languages_a, languages_b),
        "A": age(age_band_a, age_band_b),
        "D": destination(destination_ids_a, destination_ids_b),
    }


def combine(parts, weights=None):
    """Weighted sum of ``parts`` as a 0–100 integer.

    A component missing from ``parts`` counts as 0.0 — a partially scored pair
    ranks below a fully scored one instead of erroring.
    """
    weights = WEIGHTS if weights is None else weights
    total = 0.0
    for component, weight_key in COMPONENT_WEIGHT_KEYS.items():
        weight = float(weights.get(weight_key, 0.0))
        total += clamp(parts.get(component, 0.0)) * weight
    return int(round(clamp(total) * 100))


def explain(parts, weights=None, limit=3, threshold=0.01, context=None, pin=None):
    """The components that contributed most, strongest first.

    Returns a list of ``{"component", "label", "score", "contribution"}`` —
    enough for the UI to render explanation chips without re-deriving anything.
    ``contribution`` is the component's share of the final 0–100 score, so the
    entries always explain the number actually shown.

    ``context`` optionally supplies counts (e.g. ``{"shared_interests": 3}``) to
    sharpen a label from "Shared interests" to "3 shared interests". It stays
    pure formatting: no lookups, and an absent context just yields the generic
    label.

    ``pin`` names components to surface regardless of contribution — see
    ``PINNED_COMPONENTS`` for why ``D`` is one. Pinned entries come first, then
    the remaining slots are filled by contribution.
    """
    weights = WEIGHTS if weights is None else weights
    context = context or {}
    pin = PINNED_COMPONENTS if pin is None else tuple(pin)

    reasons = []
    for component, weight_key in COMPONENT_WEIGHT_KEYS.items():
        score = clamp(parts.get(component, 0.0))
        contribution = score * float(weights.get(weight_key, 0.0)) * 100
        if score <= threshold or contribution <= 0:
            continue
        reasons.append(
            {
                "component": component,
                "label": _label(component, score, context),
                "score": round(score, 4),
                "contribution": round(contribution, 2),
            }
        )

    # Pinned first, then strongest contribution; ties broken by the canonical
    # order so the output is deterministic for a given input.
    reasons.sort(
        key=lambda r: (
            0 if r["component"] in pin else 1,
            -r["contribution"],
            COMPONENTS.index(r["component"]),
        )
    )
    return reasons[:limit]


def _label(component, score, context):
    """Chip text for one component, sharpened by ``context`` where available."""
    if component == "J":
        count = context.get("shared_interests")
        if count:
            return f"{count} shared interest{'s' if count != 1 else ''}"
    elif component == "L":
        language = context.get("shared_language")
        if language:
            return f"Both speak {language.title()}"
    elif component == "B":
        if score >= 1.0:
            return "Same budget style"
    elif component == "A":
        if score >= 1.0:
            return "Same age group"
    elif component == "G":
        bucket = context.get("distance_bucket")
        if bucket:
            return bucket
    elif component == "D":
        name = context.get("shared_destination")
        if name:
            return f"Both want {name}"
    return COMPONENT_LABELS[component]


def _normalise(values):
    return {v.strip().lower() for v in (values or []) if isinstance(v, str) and v.strip()}


def _clean(value):
    return value.strip().lower() if isinstance(value, str) else ""
