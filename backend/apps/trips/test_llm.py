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
