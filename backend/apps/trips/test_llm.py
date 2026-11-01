"""Unit tests for the pure itinerary-LLM helpers.

No network, no DB — everything runs against recorded response strings, so CI
never depends on a live API (a Phase 6 acceptance requirement).
"""

from decimal import Decimal

import pytest

from apps.trips.llm import (
    DraftDay,
    DraftItem,
    ItineraryParseError,
    build_prompt,
    check_season_mismatch,
    flag_cost_outliers,
    parse_itinerary,
    validate_budget,
)

# A recorded, well-formed model response.
GOOD_RESPONSE = """
{"days": [
  {"items": [
    {"title": "Train to Goa", "category": "Transport", "est_cost": 800,
     "location": "Madgaon", "notes": "Sleeper class"},
    {"title": "Hostel night 1", "category": "Stay", "est_cost": 600,
     "location": "Panaji", "notes": ""}
  ]},
  {"items": [
    {"title": "Beach shack lunch", "category": "Food", "est_cost": 400,
     "location": "Baga", "notes": ""}
  ]}
]}
"""

# The model wrapping JSON in a markdown fence despite being told not to.
FENCED_RESPONSE = "```json\n" + GOOD_RESPONSE.strip() + "\n```"


def test_build_prompt_includes_budget_and_json_instruction():
    prompt = build_prompt(
        destination="Goa",
        budget=Decimal("2000"),
        nights=2,
        dates="2026-09-01 to 2026-09-03",
        style="relaxed",
        transport_pref="train",
        accommodation_pref="hostel",
    )
    assert "Goa" in prompt
    assert "2000" in prompt
    assert "STRICT JSON" in prompt
    assert "3 day" in prompt  # nights + 1


def test_build_prompt_without_budget():
    prompt = build_prompt("Goa", None, 1, "flexible dates", "", "", "")
    assert "No fixed budget" in prompt


def test_parse_valid_response():
    days = parse_itinerary(GOOD_RESPONSE)
    assert [d.day_index for d in days] == [0, 1]
    assert days[0].items[0].title == "Train to Goa"
    assert days[0].items[0].est_cost == Decimal("800")
    assert days[0].items[1].category == "Stay"


def test_parse_strips_markdown_fence():
    days = parse_itinerary(FENCED_RESPONSE)
    assert len(days) == 2


def test_parse_accepts_bare_list_of_days():
    days = parse_itinerary('[{"items": [{"title": "X", "category": "Food"}]}]')
    assert days[0].items[0].est_cost == Decimal("0")  # missing cost -> 0


def test_parse_unknown_category_becomes_other():
    days = parse_itinerary('{"days":[{"items":[{"title":"Spa","category":"Wellness"}]}]}')
    assert days[0].items[0].category == "Other"


@pytest.mark.parametrize(
    "raw",
    [
        "not json at all",
        "",
        '{"days": "nope"}',
        '{"days":[{"items":[{"category":"Food"}]}]}',  # item with no title
    ],
)
def test_parse_raises_on_malformed(raw):
    with pytest.raises(ItineraryParseError):
        parse_itinerary(raw)


def _plan(*costs):
    return [DraftDay(0, [DraftItem(f"i{n}", "Other", Decimal(c)) for n, c in enumerate(costs)])]


def test_validate_budget_within():
    report = validate_budget(_plan(500, 400), Decimal("1000"))
    assert report["total"] == Decimal("900")
    assert report["over_budget"] is False
    assert report["offending_items"] == []


def test_validate_budget_over_flags_priciest_items():
    report = validate_budget(_plan(1200, 300, 200), Decimal("1000"))
    assert report["over_budget"] is True
    # Removing the 1200 item alone brings 1700 -> 500, within 1000.
    assert [i.est_cost for i in report["offending_items"]] == [Decimal("1200")]


def test_validate_budget_none_target_never_over():
    report = validate_budget(_plan(9999), None)
    assert report["over_budget"] is False


# --- Phase 6.1: grounding facts, cost plausibility, season advisories -------

FACTS = {
    "name": "Goa",
    "avg_daily_budget": 2500,
    "budget_tier": "mid",
    "interest_tags": ["beach", "nightlife", "food", "adventure"],
    "best_season": "Nov-Feb",
}


def test_build_prompt_includes_facts_block_when_given():
    prompt = build_prompt(
        "Goa", Decimal("2000"), 2, "2026-09-01 to 2026-09-03",
        "relaxed", "train", "hostel", facts=FACTS,
    )
    assert "Known facts about this destination" in prompt
    assert "2500" in prompt
    assert "beach, nightlife, food, adventure" in prompt
    assert "Nov-Feb" in prompt
    assert "Do not invent named hotels" in prompt


def test_build_prompt_without_facts_omits_grounding_block():
    prompt = build_prompt("Goa", Decimal("2000"), 2, "dates", "", "", "", facts=None)
    assert "Known facts about this destination" not in prompt


def test_flag_cost_outliers_flags_implausibly_high_stay():
    # Expected Stay share for Goa (avg_daily_budget=2500) is 2500*0.40=1000;
    # 5000 is 5x that.
    days = _plan(5000)
    days[0].items[0].category = "Stay"
    flag_cost_outliers(days, FACTS)
    assert "cost_high" in days[0].items[0].flags


def test_flag_cost_outliers_flags_implausibly_low_stay():
    days = _plan(50)
    days[0].items[0].category = "Stay"
    flag_cost_outliers(days, FACTS)
    assert "cost_low" in days[0].items[0].flags


def test_flag_cost_outliers_leaves_plausible_items_unflagged():
    days = _plan(900)
    days[0].items[0].category = "Stay"
    flag_cost_outliers(days, FACTS)
    assert days[0].items[0].flags == []


def test_flag_cost_outliers_noop_without_facts():
    days = _plan(999999)
    flag_cost_outliers(days, None)
    assert days[0].items[0].flags == []


def test_check_season_mismatch_flags_out_of_season_trip():
    import datetime as dt

    advisory = check_season_mismatch(
        FACTS, dt.date(2026, 6, 1), dt.date(2026, 6, 5)
    )
    assert advisory is not None
    assert "Goa" in advisory
    assert "Nov-Feb" in advisory


def test_check_season_mismatch_silent_when_in_season():
    import datetime as dt

    advisory = check_season_mismatch(
        FACTS, dt.date(2026, 12, 1), dt.date(2026, 12, 5)
    )
    assert advisory is None


def test_check_season_mismatch_silent_when_range_wraps_year_and_matches():
    import datetime as dt

    # Nov-Feb wraps the year boundary; January should still count as in-season.
    advisory = check_season_mismatch(
        FACTS, dt.date(2026, 1, 10), dt.date(2026, 1, 15)
    )
    assert advisory is None


def test_check_season_mismatch_none_without_facts_or_dates():
    import datetime as dt

    assert check_season_mismatch(None, dt.date(2026, 6, 1), dt.date(2026, 6, 5)) is None
    assert check_season_mismatch(FACTS, None, None) is None


def test_draft_item_to_dict_includes_flags():
    item = DraftItem("Hostel", "Stay", Decimal("600"), flags=["cost_low"])
    assert item.to_dict()["flags"] == ["cost_low"]
