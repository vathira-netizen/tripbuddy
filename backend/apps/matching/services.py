"""Candidate retrieval and ranking for buddy matching.

Division of labour:

* **PostGIS** narrows the field and measures distance — ``dwithin`` against the
  GiST index on ``Profile.area_point`` plus a ``Distance`` annotation. There is
  no Python distance math anywhere.
* **apps.matching.compatibility** scores each surviving candidate. It is pure,
  so the ranking rule stays testable without a database.

Privacy: a candidate's ``area_point`` is read *only* to compute a distance here.
Neither the point nor the metre-accurate distance leaves this module — callers
get ``area_label`` (the city the user typed) and a coarse
``distance_bucket``. See ``bucket_distance``.
"""

from django.contrib.gis.db.models.functions import Distance
from django.contrib.gis.measure import D
from django.db.models import Q

from apps.accounts.models import Profile
from apps.connections.models import Connection
from apps.destinations.models import SavedDestination
from apps.matching import compatibility
from apps.matching.constants import clamp_radius_km, default_radius_km

# Upper bound of each bucket in km, with the label to show. The last entry is
# the open-ended one. Coarse on purpose: a bucket must never be narrow enough to
# trilaterate someone's position by varying the search origin.
DISTANCE_BUCKETS = (
    (10, "Under 10 km"),
    (25, "10–25 km"),
    (50, "25–50 km"),
    (100, "50–100 km"),
    (250, "100–250 km"),
    (500, "250–500 km"),
)
FAR_BUCKET_LABEL = "500+ km"
UNKNOWN_BUCKET_LABEL = "Distance unknown"


def bucket_distance(distance_m):
    """Coarsen a metre distance into a label safe to show another traveller."""
    if distance_m is None:
        return UNKNOWN_BUCKET_LABEL
    km = float(distance_m) / 1000.0
    for upper, label in DISTANCE_BUCKETS:
        if km < upper:
            return label
    return FAR_BUCKET_LABEL


def excluded_user_ids(user):
    """Users who must not appear as candidates for ``user``.

    Anyone already connected in any state: pending (a request is outstanding
    either way), accepted (already buddies), declined (do not re-suggest someone
    who said no) and blocked (must not be reachable at all). Blocking is
    symmetric here — neither side sees the other again.
    """
    ids = set()
    pairs = Connection.objects.filter(
        Q(requester=user) | Q(addressee=user)
    ).values_list("requester_id", "addressee_id")
    for requester_id, addressee_id in pairs:
        ids.add(requester_id)
        ids.add(addressee_id)
    ids.discard(user.pk)
    return ids


def saved_destination_ids(user_ids):
    """``{user_id: {destination_id, ...}}`` for the given users, in one query."""
    mapping = {}
    rows = SavedDestination.objects.filter(user_id__in=user_ids).values_list(
        "user_id", "destination_id"
    )
    for user_id, destination_id in rows:
        mapping.setdefault(user_id, set()).add(destination_id)
    return mapping


def candidate_profiles(user, radius_km, *, gender=None, age_band=None, destination_id=None):
    """Profiles inside the radius, annotated with PostGIS distance.

    Excludes the user themselves, anyone not onboarded or not phone-verified,
    anyone without an
    ``area_point`` (they cannot be placed, so they cannot be ranked honestly),
    and every user in ``excluded_user_ids``.
    """
    me = getattr(user, "profile", None)
    if me is None or me.area_point is None:
        # Without an origin there is no radius to search. The caller turns this
        # into a clear "set your city first" rather than an empty list.
        return Profile.objects.none()

    qs = (
        Profile.objects.select_related("user")
        .filter(onboarded=True)
        # Unverified accounts never appear as buddies.
        .filter(phone_verified=True)
        .exclude(user=user)
        .exclude(area_point__isnull=True)
        .filter(area_point__dwithin=(me.area_point, D(km=radius_km)))
        .annotate(distance=Distance("area_point", me.area_point))
    )

    excluded = excluded_user_ids(user)
    if excluded:
        qs = qs.exclude(user_id__in=excluded)

    if gender:
        qs = qs.filter(gender=gender)
    if age_band:
        qs = qs.filter(age_band=age_band)
    if destination_id:
        # "Travellers who also want this place."
        qs = qs.filter(user__saved_destinations__destination_id=destination_id)

    return qs.distinct()


def rank_candidates(user, *, radius_km=None, gender=None, age_band=None, destination_id=None):
    """Score every candidate and return them best-first.

    Returns a list of ``{"profile", "score", "explanation", "distance_bucket"}``.
    Ties are broken by distance so the closer of two equally compatible
    travellers is listed first, and then by id for a stable order.
    """
    radius_km = default_radius_km() if radius_km is None else clamp_radius_km(radius_km)
    radius_m = radius_km * 1000

    me = getattr(user, "profile", None)
    if me is None:
        return []

    candidates = list(
        candidate_profiles(
            user,
            radius_km,
            gender=gender,
            age_band=age_band,
            destination_id=destination_id,
        )
    )
    if not candidates:
        return []

    # One query for everyone's saved destinations rather than one per candidate.
    saved = saved_destination_ids([user.pk] + [c.user_id for c in candidates])
    my_destinations = saved.get(user.pk, set())

    results = []
    for profile in candidates:
        distance_m = profile.distance.m if profile.distance is not None else None
        their_destinations = saved.get(profile.user_id, set())

        parts = compatibility.score_parts(
            distance_m=distance_m,
            radius_m=radius_m,
            interests_a=me.interests,
            interests_b=profile.interests,
            budget_style_a=me.budget_style,
            budget_style_b=profile.budget_style,
            languages_a=me.languages,
            languages_b=profile.languages,
            age_band_a=me.age_band,
            age_band_b=profile.age_band,
            destination_ids_a=my_destinations,
            destination_ids_b=their_destinations,
        )

        bucket = bucket_distance(distance_m)
        results.append(
            {
                "profile": profile,
                "score": compatibility.combine(parts),
                "explanation": compatibility.explain(
                    parts,
                    context=_explanation_context(
                        me, profile, my_destinations, their_destinations, bucket
                    ),
                ),
                "distance_bucket": bucket,
                # Sort key only — never serialised. See the module docstring.
                "_distance_m": distance_m,
            }
        )

    results.sort(
        key=lambda r: (
            -r["score"],
            r["_distance_m"] if r["_distance_m"] is not None else float("inf"),
            r["profile"].pk,
        )
    )
    return results


def _explanation_context(me, profile, my_destinations, their_destinations, bucket):
    """Counts and names that sharpen the explanation chips."""
    shared_interests = _overlap(me.interests, profile.interests)
    shared_languages = _overlap(me.languages, profile.languages)

    context = {
        "shared_interests": len(shared_interests),
        "distance_bucket": bucket,
    }
    if shared_languages:
        context["shared_language"] = sorted(shared_languages)[0]

    shared_destination_ids = my_destinations & their_destinations
    if shared_destination_ids:
        # Only reached when there is a shared destination, so at most one extra
        # query per response — not per candidate.
        name = _destination_name(next(iter(sorted(shared_destination_ids))))
        if name:
            context["shared_destination"] = name
    return context


def _destination_name(destination_id):
    from apps.destinations.models import Destination

    return (
        Destination.objects.filter(pk=destination_id)
        .values_list("name", flat=True)
        .first()
    )


def _overlap(a, b):
    set_a = {v.strip().lower() for v in (a or []) if isinstance(v, str) and v.strip()}
    set_b = {v.strip().lower() for v in (b or []) if isinstance(v, str) and v.strip()}
    return set_a & set_b
