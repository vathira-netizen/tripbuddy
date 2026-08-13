"""Pure itinerary-LLM helpers: prompt in, structured plan out.

No network and no Django ORM in this module — every function takes plain data
and returns plain data (or raises), so the risky parts (prompt shape, JSON
parsing, budget validation) are unit-testable against recorded responses with
no live API call. The network boundary lives in ``apps.trips.ai_service``.

The golden rule for Phase 6: the model is never trusted blindly. ``est_cost``
figures it returns are re-summed and checked against the trip's budget here,
never taken on faith.
"""

import json
import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

# Must match apps.budgets.models.BudgetItem.Category so a draft item can become
# a real BudgetItem without translation.
VALID_CATEGORIES = ("Transport", "Stay", "Food", "Activities", "Other")


class ItineraryParseError(ValueError):
    """The model returned something we can't turn into a day-by-day plan."""


@dataclass
class DraftItem:
    title: str
    category: str
    est_cost: Decimal
    location: str = ""
    notes: str = ""

    def to_dict(self) -> dict:
        # est_cost as a string keeps Decimal precision through JSON.
        return {
            "title": self.title,
            "category": self.category,
            "est_cost": str(self.est_cost),
            "location": self.location,
            "notes": self.notes,
        }


@dataclass
class DraftDay:
    day_index: int
    items: list[DraftItem] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "day_index": self.day_index,
            "items": [item.to_dict() for item in self.items],
        }


def build_prompt(
    destination,
    budget,
    nights,
    dates,
    style,
    transport_pref,
    accommodation_pref,
) -> str:
    """A strict-JSON instruction for the model.

    Everything the caller knows about the trip is folded into one text prompt.
    ``budget`` may be None (no target set); the others are plain strings/ints.
    """
    budget_line = (
        f"Keep the combined est_cost of all items at or under {budget} "
        "(the traveller's total budget for the whole trip)."
        if budget is not None
        else "No fixed budget; keep costs reasonable and note them."
    )
    days = max(int(nights) + 1, 1)
    return (
        "You are a budget-conscious travel planner. Draft a day-by-day "
        f"itinerary for a trip to {destination or 'the destination'} over "
        f"{days} day(s) ({dates}).\n"
        f"Travel style: {style or 'any'}. "
        f"Transport preference: {transport_pref or 'any'}. "
        f"Accommodation preference: {accommodation_pref or 'any'}.\n"
        f"{budget_line}\n"
        "Prioritise trains and buses over flights, and budget stays over "
        "luxury ones.\n\n"
        "Respond with STRICT JSON ONLY — no prose, no markdown fences. Shape:\n"
        '{"days": [{"items": [{"title": str, "category": one of '
        f'{list(VALID_CATEGORIES)}, "est_cost": number, "location": str, '
        '"notes": str}]}]}\n'
        "One object per day, in order. est_cost is a number in the trip's "
        "currency. Every item needs a title and a category."
    )


_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)


def _strip_fences(raw: str) -> str:
    """Drop a leading/trailing ```json fence the model may add despite asking."""
    return _FENCE_RE.sub("", _FENCE_RE.sub("", raw.strip()))


def _to_decimal(value) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0")


def parse_itinerary(raw: str) -> list[DraftDay]:
    """Parse the model's JSON into typed days/items, raising on malformed output.

    Lenient about the *values* (unknown category -> "Other", bad/missing cost
    -> 0) but strict about the *structure*: it must be JSON describing a list
    of days each holding a list of titled items.
    """
    if not isinstance(raw, str) or not raw.strip():
        raise ItineraryParseError("Empty response from the model.")

    try:
        data = json.loads(_strip_fences(raw))
    except json.JSONDecodeError as exc:
        raise ItineraryParseError(f"Not valid JSON: {exc}") from exc

    # Accept {"days": [...]} or a bare list of days.
    if isinstance(data, dict):
        raw_days = data.get("days")
    elif isinstance(data, list):
        raw_days = data
    else:
        raw_days = None
    if not isinstance(raw_days, list):
        raise ItineraryParseError("Expected a list of days.")

    days: list[DraftDay] = []
    for index, raw_day in enumerate(raw_days):
        if isinstance(raw_day, dict):
            raw_items = raw_day.get("items", [])
        elif isinstance(raw_day, list):
            raw_items = raw_day
        else:
            raise ItineraryParseError(f"Day {index} is not an object.")
        if not isinstance(raw_items, list):
            raise ItineraryParseError(f"Day {index} has a non-list 'items'.")

        items: list[DraftItem] = []
        for raw_item in raw_items:
            if not isinstance(raw_item, dict):
                raise ItineraryParseError(f"Day {index} has a non-object item.")
            title = str(raw_item.get("title", "")).strip()
            if not title:
                raise ItineraryParseError(f"Day {index} has an item with no title.")
            category = raw_item.get("category")
            if category not in VALID_CATEGORIES:
                category = "Other"
            items.append(
                DraftItem(
                    title=title[:200],
                    category=category,
                    est_cost=_to_decimal(raw_item.get("est_cost")),
                    location=str(raw_item.get("location", "")).strip(),
                    notes=str(raw_item.get("notes", "")).strip(),
                )
            )
        days.append(DraftDay(day_index=index, items=items))

    if not days:
        raise ItineraryParseError("No days in the plan.")
    return days


def validate_budget(days: list[DraftDay], budget) -> dict:
    """Re-sum the plan's own costs and check them against ``budget``.

    Returns {total, over_budget, per_category, offending_items}. When over
    budget, ``offending_items`` is the greedy set of priciest items whose
    removal would bring the plan back within budget — what the UI highlights.
    """
    items = [item for day in days for item in day.items]
    total = sum((item.est_cost for item in items), Decimal("0"))

    per_category: dict[str, Decimal] = {}
    for item in items:
        per_category[item.category] = (
            per_category.get(item.category, Decimal("0")) + item.est_cost
        )

    over_budget = budget is not None and total > budget
    offending: list[DraftItem] = []
    if over_budget:
        running = total
        for item in sorted(items, key=lambda i: i.est_cost, reverse=True):
            if running <= budget:
                break
            offending.append(item)
            running -= item.est_cost

    return {
        "total": total,
        "over_budget": over_budget,
        "per_category": per_category,
        "offending_items": offending,
    }
