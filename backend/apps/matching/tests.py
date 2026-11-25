"""Matching: the pure scoring rule, and the ranked /api/buddies/ endpoint.

The ``compatibility`` tests below need no database — that is the point of
keeping the scoring rule pure. The API tests do, and they additionally assert
the privacy contract: no coordinate, and no exact distance, in any response.
"""

import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from rest_framework.test import APIClient

from apps.accounts.authentication import SUPABASE_AUDIENCE
from apps.accounts.models import Profile
from apps.common.choices import AGE_BAND_ORDER, INTEREST_TAGS, LANGUAGES
from apps.connections.models import Connection
from apps.destinations.models import Destination, SavedDestination
from apps.matching import compatibility as C
from apps.matching import constants, services

User = get_user_model()
SECRET = "test-jwt-secret"

# Bengaluru, and points at increasing real distances from it.
BLR = (12.9716, 77.5946)
MYSURU = (12.2958, 76.6394)  # ~140 km
CHENNAI = (13.0827, 80.2707)  # ~290 km
DELHI = (28.6139, 77.2090)  # ~1750 km


# --- G: proximity ---------------------------------------------------------


def test_proximity_is_one_at_zero_distance():
    assert C.proximity(0, 100_000) == 1.0


def test_proximity_falls_linearly_to_zero_at_the_radius():
    assert C.proximity(50_000, 100_000) == pytest.approx(0.5)
    assert C.proximity(75_000, 100_000) == pytest.approx(0.25)
    assert C.proximity(100_000, 100_000) == 0.0


def test_proximity_clamps_beyond_the_radius():
    # Never negative: a distant candidate scores 0 on G, not a penalty.
    assert C.proximity(500_000, 100_000) == 0.0


def test_proximity_without_a_distance_scores_zero_rather_than_raising():
    assert C.proximity(None, 100_000) == 0.0
    assert C.proximity(1000, None) == 0.0


def test_proximity_with_a_nonsensical_radius_scores_zero():
    assert C.proximity(1000, 0) == 0.0
    assert C.proximity(1000, -5) == 0.0
    assert C.proximity(-1000, 100_000) == 0.0


# --- J / L: jaccard -------------------------------------------------------


def test_jaccard_of_identical_sets_is_one():
    assert C.jaccard(["food", "trekking"], ["trekking", "food"]) == 1.0


def test_jaccard_of_disjoint_sets_is_zero():
    assert C.jaccard(["food"], ["nightlife"]) == 0.0


def test_jaccard_is_intersection_over_union():
    # {a,b} vs {b,c} -> 1 shared of 3 distinct
    assert C.jaccard(["a", "b"], ["b", "c"]) == pytest.approx(1 / 3)


def test_jaccard_of_two_empty_sets_is_zero_not_a_division_error():
    assert C.jaccard([], []) == 0.0
    assert C.jaccard(None, None) == 0.0
    assert C.jaccard(["food"], []) == 0.0


def test_jaccard_ignores_case_and_whitespace_and_duplicates():
    assert C.jaccard([" Food ", "FOOD", "food"], ["food"]) == 1.0


def test_jaccard_ignores_non_string_entries():
    assert C.jaccard(["food", None, 3], ["food"]) == 1.0


def test_interests_and_languages_both_use_jaccard():
    assert C.interests(["a"], ["a"]) == 1.0
    assert C.languages(["hindi"], ["hindi", "tamil"]) == pytest.approx(0.5)


# --- B: budget style ------------------------------------------------------


def test_budget_same_style_scores_one():
    for tier in ("budget", "mid", "comfort"):
        assert C.budget(tier, tier) == 1.0


def test_budget_adjacent_tiers_get_partial_credit():
    assert C.budget("budget", "mid") == pytest.approx(0.5)
    assert C.budget("mid", "comfort") == pytest.approx(0.5)
    assert C.budget("comfort", "mid") == pytest.approx(0.5)


def test_budget_opposite_extremes_score_zero():
    assert C.budget("budget", "comfort") == 0.0


def test_budget_missing_or_unknown_style_scores_zero():
    assert C.budget("", "mid") == 0.0
    assert C.budget("mid", None) == 0.0
    assert C.budget("lavish", "mid") == 0.0


def test_budget_is_case_insensitive():
    assert C.budget("Budget", "budget") == 1.0


def test_budget_survives_a_single_tier_vocabulary():
    # If the tier vocabulary ever collapsed to one value, everyone would agree
    # on budget rather than the scorer dividing by a zero span.
    assert C.budget("only", "only", tier_order=["only"]) == 1.0
    assert C.budget("only", "other", tier_order=["only"]) == 0.0


# --- A: age band ----------------------------------------------------------


def test_age_same_band_scores_one():
    assert C.age("21-23", "21-23") == 1.0


def test_age_adjacent_band_scores_half():
    assert C.age("21-23", "24-26") == 0.5
    assert C.age("24-26", "21-23") == 0.5


def test_age_distant_bands_score_zero():
    assert C.age("18-20", "31+") == 0.0
    assert C.age("18-20", "24-26") == 0.0


def test_age_missing_or_unknown_band_scores_zero():
    assert C.age("", "21-23") == 0.0
    assert C.age("21-23", None) == 0.0
    assert C.age("99-100", "21-23") == 0.0


# --- D: shared destination ------------------------------------------------


def test_destination_shared_scores_one():
    assert C.destination([1, 2], [2, 3]) == 1.0


def test_destination_not_shared_scores_zero():
    assert C.destination([1], [2]) == 0.0
    assert C.destination([], [1]) == 0.0
    assert C.destination(None, None) == 0.0


# --- WEIGHTS / combine ----------------------------------------------------


def test_weights_sum_to_one_so_the_score_can_reach_100():
    assert sum(C.WEIGHTS.values()) == pytest.approx(1.0)
    assert constants.validate_weights() is True


def test_every_component_has_a_weight_and_a_label():
    for component in C.COMPONENTS:
        assert C.COMPONENT_WEIGHT_KEYS[component] in C.WEIGHTS
        assert C.COMPONENT_LABELS[component]


def test_validate_weights_rejects_a_bad_distribution():
    with pytest.raises(ValueError):
        constants.validate_weights({"wG": 0.5, "wJ": 0.2})
    with pytest.raises(ValueError):
        constants.validate_weights({"wG": 1.5, "wJ": -0.5})
    with pytest.raises(ValueError):
        constants.validate_weights({})


def test_combine_of_a_perfect_match_is_100():
    assert C.combine({c: 1.0 for c in C.COMPONENTS}) == 100


def test_combine_of_nothing_in_common_is_zero():
    assert C.combine({c: 0.0 for c in C.COMPONENTS}) == 0


def test_combine_is_the_weighted_sum():
    parts = {"G": 1.0, "J": 1.0, "B": 0.0, "L": 0.0, "A": 0.0, "D": 0.0}
    expected = (C.WEIGHTS["wG"] + C.WEIGHTS["wJ"]) * 100
    assert C.combine(parts) == int(round(expected))


def test_combine_treats_a_missing_component_as_zero():
    assert C.combine({"J": 1.0}) == int(round(C.WEIGHTS["wJ"] * 100))
    assert C.combine({}) == 0


def test_combine_clamps_out_of_range_component_scores():
    # A component that somehow returns >1 must not push the total past 100.
    assert C.combine({c: 5.0 for c in C.COMPONENTS}) == 100
    assert C.combine({c: -5.0 for c in C.COMPONENTS}) == 0


def test_combine_accepts_custom_weights():
    weights = {"wG": 1.0, "wJ": 0.0, "wB": 0.0, "wL": 0.0, "wA": 0.0, "wD": 0.0}
    assert C.combine({"G": 0.5, "J": 1.0}, weights) == 50


# --- explain --------------------------------------------------------------


def test_explain_ranks_by_contribution_not_by_raw_score():
    # A perfect age match (0.10) must rank below a half interest match (0.15).
    parts = {"G": 0.0, "J": 0.5, "B": 0.0, "L": 0.0, "A": 1.0, "D": 0.0}
    reasons = C.explain(parts)
    assert [r["component"] for r in reasons] == ["J", "A"]


def test_explain_limits_the_number_of_chips():
    parts = {c: 1.0 for c in C.COMPONENTS}
    assert len(C.explain(parts, limit=3)) == 3
    assert len(C.explain(parts, limit=6)) == 6


def test_explain_omits_components_that_contributed_nothing():
    parts = {"G": 0.0, "J": 1.0, "B": 0.0, "L": 0.0, "A": 0.0, "D": 0.0}
    assert [r["component"] for r in C.explain(parts)] == ["J"]


def test_explain_contributions_are_the_share_of_the_final_score():
    parts = {c: 1.0 for c in C.COMPONENTS}
    reasons = C.explain(parts, limit=6)
    assert sum(r["contribution"] for r in reasons) == pytest.approx(100.0)


def test_explain_is_deterministic_for_tied_contributions():
    parts = {"G": 1.0, "B": 1.0, "J": 0.0, "L": 0.0, "A": 0.0, "D": 0.0}
    # wG == wB, so the canonical component order breaks the tie.
    assert [r["component"] for r in C.explain(parts)] == ["G", "B"]


def test_explain_pins_the_shared_destination_chip_despite_its_small_weight():
    # D has the lowest weight, so a contribution-only ranking would always cut
    # it from the top 3 — yet it is the most informative chip when present.
    parts = {c: 1.0 for c in C.COMPONENTS}
    assert [r["component"] for r in C.explain(parts)][0] == "D"


def test_pinning_does_not_invent_a_reason_that_scored_zero():
    parts = {"J": 1.0, "D": 0.0}
    assert [r["component"] for r in C.explain(parts)] == ["J"]


def test_pinning_is_overridable():
    parts = {c: 1.0 for c in C.COMPONENTS}
    assert [r["component"] for r in C.explain(parts, pin=())][0] == "J"


def test_explain_uses_generic_labels_without_context():
    reasons = C.explain({"J": 1.0})
    assert reasons[0]["label"] == C.COMPONENT_LABELS["J"]


def test_explain_sharpens_labels_from_context():
    context = {
        "shared_interests": 3,
        "shared_language": "kannada",
        "distance_bucket": "Under 10 km",
        "shared_destination": "Goa",
    }
    parts = {c: 1.0 for c in C.COMPONENTS}
    labels = {r["component"]: r["label"] for r in C.explain(parts, limit=6, context=context)}
    assert labels["J"] == "3 shared interests"
    assert labels["L"] == "Both speak Kannada"
    assert labels["G"] == "Under 10 km"
    assert labels["D"] == "Both want Goa"
    assert labels["B"] == "Same budget style"
    assert labels["A"] == "Same age group"


def test_explain_singular_interest_label():
    reasons = C.explain({"J": 1.0}, context={"shared_interests": 1})
    assert reasons[0]["label"] == "1 shared interest"


# --- distance buckets -----------------------------------------------------


@pytest.mark.parametrize(
    "metres,expected",
    [
        (0, "Under 10 km"),
        (9_999, "Under 10 km"),
        (10_000, "10–25 km"),
        (24_999, "10–25 km"),
        (25_000, "25–50 km"),
        (60_000, "50–100 km"),
        (150_000, "100–250 km"),
        (300_000, "250–500 km"),
        (900_000, "500+ km"),
        (None, "Distance unknown"),
    ],
)
def test_distance_is_bucketed_never_exact(metres, expected):
    assert services.bucket_distance(metres) == expected


# --- radius ---------------------------------------------------------------


def test_default_radius_is_150km():
    assert constants.DEFAULT_RADIUS_KM == 150
    assert constants.default_radius_km() == 150


def test_radius_is_clamped_both_ways():
    assert constants.clamp_radius_km(0) == constants.MIN_RADIUS_KM
    assert constants.clamp_radius_km(10**9) == constants.MAX_RADIUS_KM
    assert constants.clamp_radius_km(75) == 75


def test_configured_radius_is_clamped(settings):
    settings.MATCH_DEFAULT_RADIUS_KM = 99999
    assert constants.default_radius_km() == constants.MAX_RADIUS_KM


# --- API ------------------------------------------------------------------


def make_token(sub, email="trav@example.com"):
    now = datetime.now(tz=timezone.utc)
    return jwt.encode(
        {
            "sub": str(sub),
            "email": email,
            "aud": SUPABASE_AUDIENCE,
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(hours=1)).timestamp()),
        },
        SECRET,
        algorithm="HS256",
    )


@pytest.fixture
def settings_secret(settings):
    settings.SUPABASE_JWT_SECRET = SECRET
    return settings


def make_traveller(
    username,
    *,
    at=BLR,
    interests=("trekking", "food"),
    languages=("english", "kannada"),
    budget_style="budget",
    age_band="21-23",
    gender="female",
    onboarded=True,
    phone_verified=True,
):
    user = User.objects.create_user(username=username)
    sub = uuid.uuid4()
    point = None if at is None else Point(at[1], at[0], srid=4326)
    profile = Profile.objects.create(
        user=user,
        supabase_user_id=sub,
        display_name=username.title(),
        interests=list(interests),
        languages=list(languages),
        budget_style=budget_style,
        age_band=age_band,
        gender=gender,
        area_label=f"{username.title()} City",
        area_point=point,
        onboarded=onboarded,
        phone_verified=phone_verified,
    )
    return user, profile


def client_for(profile, settings_secret):
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {make_token(profile.supabase_user_id)}")
    return c


@pytest.mark.django_db
def test_buddies_requires_authentication():
    assert APIClient().get("/api/buddies/").status_code == 401


# --- women_only ---------------------------------------------------------------


@pytest.mark.django_db
def test_women_only_requires_verified_female_requester(settings_secret):
    _, woman = make_traveller("woman", at=BLR, gender="female")
    woman.email_verified = True
    woman.save()
    make_traveller("man", at=MYSURU, gender="male")

    resp = client_for(woman, settings_secret).get("/api/buddies/?radius_km=500&women_only=true")
    assert resp.status_code == 200


@pytest.mark.django_db
def test_women_only_rejects_unverified_female(settings_secret):
    _, woman = make_traveller("unverified-woman", at=BLR, gender="female")
    assert woman.email_verified is False

    resp = client_for(woman, settings_secret).get("/api/buddies/?women_only=true")
    assert resp.status_code == 403


@pytest.mark.django_db
def test_women_only_rejects_male_requester(settings_secret):
    _, man = make_traveller("verified-man", at=BLR, gender="male")
    man.email_verified = True
    man.save()

    resp = client_for(man, settings_secret).get("/api/buddies/?women_only=true")
    assert resp.status_code == 403


@pytest.mark.django_db
def test_women_only_filters_out_male_candidates(settings_secret):
    _, woman = make_traveller("host", at=BLR, gender="female")
    woman.email_verified = True
    woman.save()
    make_traveller("nearby-man", at=BLR, gender="male")
    make_traveller("nearby-woman", at=BLR, gender="female")

    resp = client_for(woman, settings_secret).get(
        "/api/buddies/?radius_km=500&women_only=true"
    )
    assert resp.status_code == 200
    names = {c["display_name"] for c in resp.data["results"]}
    assert names == {"Nearby-Woman"}


@pytest.mark.django_db
def test_buddies_lists_nearby_candidates_ranked(settings_secret):
    me_user, me = make_traveller("me", at=BLR)
    # Perfect match, very close.
    make_traveller("twin", at=BLR)
    # Same city but nothing else in common.
    make_traveller(
        "opposite",
        at=BLR,
        interests=("shopping",),
        languages=("odia",),
        budget_style="comfort",
        age_band="31+",
    )

    response = client_for(me, settings_secret).get("/api/buddies/")
    assert response.status_code == 200

    names = [r["display_name"] for r in response.data["results"]]
    assert names == ["Twin", "Opposite"]
    assert response.data["count"] == 2
    assert response.data["results"][0]["score"] > response.data["results"][1]["score"]


@pytest.mark.django_db
def test_buddy_payload_never_exposes_coordinates(settings_secret):
    _, me = make_traveller("me", at=BLR)
    make_traveller("other", at=MYSURU)

    response = client_for(me, settings_secret).get("/api/buddies/?radius_km=300")
    candidate = response.data["results"][0]

    # The allow-list is the contract: anything not here cannot leak.
    assert set(candidate) == {
        "supabase_user_id",
        "display_name",
        "avatar_url",
        "bio",
        "travel_styles",
        "badges",
        "age_band",
        "gender",
        "languages",
        "interests",
        "budget_style",
        "area_label",
        "distance_bucket",
        "score",
        "explanation",
    }
    body = response.content.decode()
    for forbidden in ("area_point", "lat", "lng", "coordinates", "distance_m"):
        assert forbidden not in body
    # A bucket label, never a number.
    assert candidate["distance_bucket"] == "100–250 km"


@pytest.mark.django_db
def test_buddies_excludes_self_and_non_onboarded(settings_secret):
    _, me = make_traveller("me", at=BLR)
    make_traveller("ghost", at=BLR, onboarded=False)

    response = client_for(me, settings_secret).get("/api/buddies/")
    assert response.data["results"] == []


@pytest.mark.django_db
def test_buddies_excludes_travellers_without_an_area(settings_secret):
    _, me = make_traveller("me", at=BLR)
    make_traveller("placeless", at=None)

    response = client_for(me, settings_secret).get("/api/buddies/")
    assert response.data["results"] == []


@pytest.mark.django_db
def test_buddies_respects_the_radius(settings_secret):
    _, me = make_traveller("me", at=BLR)
    make_traveller("faraway", at=DELHI)

    small = client_for(me, settings_secret).get("/api/buddies/?radius_km=100")
    assert small.data["results"] == []

    large = client_for(me, settings_secret).get("/api/buddies/?radius_km=2000")
    assert [r["display_name"] for r in large.data["results"]] == ["Faraway"]


@pytest.mark.django_db
@pytest.mark.parametrize(
    "status_value",
    ["pending", "accepted", "declined", "blocked"],
)
def test_buddies_excludes_anyone_already_connected(settings_secret, status_value):
    me_user, me = make_traveller("me", at=BLR)
    other_user, _ = make_traveller("other", at=BLR)
    Connection.objects.create(
        requester=me_user, addressee=other_user, status=status_value
    )

    response = client_for(me, settings_secret).get("/api/buddies/")
    assert response.data["results"] == []


@pytest.mark.django_db
def test_block_hides_the_pair_in_both_directions(settings_secret):
    me_user, me = make_traveller("me", at=BLR)
    other_user, other = make_traveller("other", at=BLR)
    # They blocked me, not the other way round.
    Connection.objects.create(
        requester=other_user,
        addressee=me_user,
        status=Connection.Status.BLOCKED,
        blocked_by=other_user,
    )

    assert client_for(me, settings_secret).get("/api/buddies/").data["results"] == []
    assert client_for(other, settings_secret).get("/api/buddies/").data["results"] == []


@pytest.mark.django_db
def test_buddies_filters_by_gender_and_age_band(settings_secret):
    _, me = make_traveller("me", at=BLR)
    make_traveller("fem", at=BLR, gender="female", age_band="21-23")
    make_traveller("masc", at=BLR, gender="male", age_band="27-30")

    client = client_for(me, settings_secret)
    by_gender = client.get("/api/buddies/?gender=male")
    assert [r["display_name"] for r in by_gender.data["results"]] == ["Masc"]

    by_age = client.get("/api/buddies/?age_band=21-23")
    assert [r["display_name"] for r in by_age.data["results"]] == ["Fem"]


@pytest.mark.django_db
def test_buddies_filters_by_target_destination(settings_secret):
    _, me = make_traveller("me", at=BLR)
    wants_user, _ = make_traveller("wants", at=BLR)
    make_traveller("indifferent", at=BLR)

    goa = Destination.objects.create(
        name="Goa",
        slug="goa",
        point=Point(74.124, 15.2993, srid=4326),
        avg_daily_budget=2500,
        budget_tier="mid",
        interest_tags=["beach"],
    )
    SavedDestination.objects.create(user=wants_user, destination=goa)

    response = client_for(me, settings_secret).get(f"/api/buddies/?destination={goa.pk}")
    assert [r["display_name"] for r in response.data["results"]] == ["Wants"]


@pytest.mark.django_db
def test_shared_destination_boosts_the_score_and_is_explained(settings_secret):
    me_user, me = make_traveller("me", at=BLR)
    sharer_user, _ = make_traveller("sharer", at=BLR)
    make_traveller("loner", at=BLR)

    goa = Destination.objects.create(
        name="Goa",
        slug="goa",
        point=Point(74.124, 15.2993, srid=4326),
        avg_daily_budget=2500,
        budget_tier="mid",
        interest_tags=["beach"],
    )
    SavedDestination.objects.create(user=me_user, destination=goa)
    SavedDestination.objects.create(user=sharer_user, destination=goa)

    results = client_for(me, settings_secret).get("/api/buddies/").data["results"]
    by_name = {r["display_name"]: r for r in results}

    assert by_name["Sharer"]["score"] > by_name["Loner"]["score"]
    labels = [e["label"] for e in by_name["Sharer"]["explanation"]]
    assert any("Goa" in label for label in labels)


@pytest.mark.django_db
def test_retuning_the_weights_reorders_the_ranking(settings_secret, monkeypatch):
    """The weights are the tuning surface (TBD-1), so tuning must actually bite.

    Near-but-unlike versus far-but-alike is the case that separates them: which
    one wins is a statement about the weights, not about the data.
    """
    _, me = make_traveller("me", at=BLR, interests=("trekking", "food"))
    make_traveller(
        "nearstranger", at=BLR, interests=("shopping",), languages=("odia",)
    )
    make_traveller("fartwin", at=CHENNAI, interests=("trekking", "food"))

    def ranking():
        page = client_for(me, settings_secret).get("/api/buddies/?radius_km=500")
        return [r["display_name"] for r in page.data["results"]]

    # Interests outweigh proximity by default, so the distant twin wins.
    assert ranking() == ["Fartwin", "Nearstranger"]

    # Make proximity dominate and the order inverts.
    monkeypatch.setitem(C.WEIGHTS, "wG", 0.90)
    monkeypatch.setitem(C.WEIGHTS, "wJ", 0.02)
    monkeypatch.setitem(C.WEIGHTS, "wB", 0.02)
    monkeypatch.setitem(C.WEIGHTS, "wL", 0.02)
    monkeypatch.setitem(C.WEIGHTS, "wA", 0.02)
    monkeypatch.setitem(C.WEIGHTS, "wD", 0.02)

    assert ranking() == ["Nearstranger", "Fartwin"]


@pytest.mark.django_db
def test_weights_are_restored_after_tuning(monkeypatch):
    # Guards the test above: monkeypatch must not leak a retuned weight into
    # the rest of the suite.
    assert sum(C.WEIGHTS.values()) == pytest.approx(1.0)
    assert C.WEIGHTS["wJ"] == 0.30


@pytest.mark.django_db
def test_explanation_chips_describe_the_match(settings_secret):
    _, me = make_traveller("me", at=BLR)
    make_traveller("twin", at=BLR)

    candidate = client_for(me, settings_secret).get("/api/buddies/").data["results"][0]
    assert candidate["score"] > 0
    assert candidate["explanation"]
    for chip in candidate["explanation"]:
        assert set(chip) == {"component", "label", "score", "contribution"}
        assert chip["label"]


@pytest.mark.django_db
def test_buddies_tells_the_user_to_set_a_city_when_they_have_no_area(settings_secret):
    _, me = make_traveller("me", at=None)

    response = client_for(me, settings_secret).get("/api/buddies/")
    assert response.status_code == 409
    assert response.data["code"] == "no_area"
    assert response.data["results"] == []


@pytest.mark.django_db
def test_service_returns_nothing_for_a_traveller_with_no_area():
    # The view answers 409 before reaching this, but the service must not
    # depend on the view for that guard.
    user, _ = make_traveller("placeless", at=None)
    make_traveller("somebody", at=BLR)

    assert list(services.candidate_profiles(user, 150)) == []
    assert services.rank_candidates(user) == []


@pytest.mark.django_db
def test_service_returns_nothing_for_a_user_with_no_profile():
    # Authentication normally creates a Profile, so this is the "should never
    # happen" path: it must return empty, not raise.
    user = User.objects.create_user(username="profileless")
    make_traveller("somebody", at=BLR)

    assert list(services.candidate_profiles(user, 150)) == []
    assert services.rank_candidates(user) == []


@pytest.mark.django_db
def test_buddies_rejects_invalid_filters(settings_secret):
    _, me = make_traveller("me", at=BLR)
    client = client_for(me, settings_secret)

    assert client.get("/api/buddies/?gender=wizard").status_code == 400
    assert client.get("/api/buddies/?age_band=99-100").status_code == 400
    assert client.get("/api/buddies/?radius_km=0").status_code == 400
    assert client.get("/api/buddies/?radius_km=abc").status_code == 400


@pytest.mark.django_db
def test_shared_vocabularies_stay_in_lockstep():
    # The engine compares profile tags against destination tags directly.
    assert INTEREST_TAGS and LANGUAGES
    assert AGE_BAND_ORDER[0] == "18-20"
    assert AGE_BAND_ORDER[-1] == "31+"
