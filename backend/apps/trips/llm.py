"""Pure itinerary-LLM helpers: prompt in, structured plan out.

No network and no Django ORM in this module — every function takes plain data
and returns plain data (or raises), so the risky parts (prompt shape, JSON
parsing, budget validation) are unit-testable against recorded responses with
no live API call. The network boundary lives in ``apps.trips.ai_service``.

The golden rule for Phase 6: the model is never trusted blindly. ``est_cost``
figures it returns are re-summed and checked against the trip's budget here,
never taken on faith.

Phase 6.1 adds a second kind of scepticism: even a within-budget plan can be
unrealistic (an implausibly cheap "5-star stay", a July trip to a place whose
best season is November) or reference a venue nobody can confirm exists. This
module cannot verify that a named place is real — the destination catalogue
has no venue-level data, only city-level facts (typical spend, budget tier,
tags, season). So instead of a false "verified" claim, it does the honest
version: ground the prompt in those real facts, and flag numbers/dates that
don't fit them. See ``flag_cost_outliers`` and ``check_season_mismatch``.
"""

import json
import re
from dataclasses import dataclass, field
from datetime import timedelta
from decimal import Decimal, InvalidOperation

# Must match apps.budgets.models.BudgetItem.Category so a draft item can become
# a real BudgetItem without translation.
VALID_CATEGORIES = ("Transport", "Stay", "Food", "Activities", "Other")

# Rough share of a destination's average daily budget each category tends to
# take. Deliberately coarse — this exists only to sanity-check the model's
# own numbers against a domain prior, never to dictate them. A category not
# listed falls back to 0.15 (see flag_cost_outliers).
CATEGORY_DAILY_SHARE = {
    "Stay": Decimal("0.40"),
    "Food": Decimal("0.25"),
    "Activities": Decimal("0.20"),
    "Transport": Decimal("0.10"),
    "Other": Decimal("0.05"),
}

# destinations.Destination.best_season strings look like "Nov-Feb" or
# "Oct-Mar" — three-letter month abbreviations, hyphen-joined, sometimes
# wrapping the year boundary.
_MONTH_ABBR = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
]


class ItineraryParseError(ValueError):
    """The model returned something we can't turn into a day-by-day plan."""


@dataclass
class DraftItem:
    title: str
    category: str
    est_cost: Decimal
    location: str = ""
    notes: str = ""
    # Reasons this item looked off against what we actually know about the
    # destination — see flag_cost_outliers. Never set by parsing; the model
    # never gets to flag its own output.
    flags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        # est_cost as a string keeps Decimal precision through JSON.
        return {
            "title": self.title,
            "category": self.category,
            "est_cost": str(self.est_cost),
            "location": self.location,
            "notes": self.notes,
            "flags": self.flags,
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
    facts: dict | None = None,
) -> str:
    """A strict-JSON instruction for the model.

    Everything the caller knows about the trip is folded into one text prompt.
    ``budget`` may be None (no target set); the others are plain strings/ints.

    ``facts`` is the destination's own curated data (see
    ``apps.trips.ai_service._destination_facts``) — typical spend, budget
    tier, interest tags, best season. When present it's folded in as a
    grounding block so the model anchors to real numbers instead of
    free-associating, and is told not to invent named venues it can't be
    confident about. This doesn't make the output verified; it makes it less
    likely to drift from what we actually know.
    """
    budget_line = (
        f"Keep the combined est_cost of all items at or under {budget} "
        "(the traveller's total budget for the whole trip)."
        if budget is not None
        else "No fixed budget; keep costs reasonable and note them."
    )
    days = max(int(nights) + 1, 1)

    facts_block = ""
    if facts:
        tags = ", ".join(facts.get("interest_tags") or []) or "none listed"
        facts_block = (
            "\nKnown facts about this destination — ground your plan in these, "
            "don't contradict them:\n"
            f"- Typical spend for a budget traveller: about "
            f"{facts.get('avg_daily_budget')} INR per person per day "
            f"({facts.get('budget_tier', 'unknown')} tier).\n"
            f"- Known for: {tags}.\n"
            f"- Best season to visit: {facts.get('best_season') or 'not recorded'}.\n"
            "Keep per-day costs consistent with that typical spend, and prefer "
            "activities that match what this destination is known for. Do not "
            "invent named hotels, restaurants, or attractions you aren't "
            "reasonably confident are real — prefer describing the type of "
            "place (e.g. 'a budget hostel near the beach') over a specific "
            "name if you're not sure one exists.\n"
        )

    return (
        "You are a budget-conscious travel planner. Draft a day-by-day "
        f"itinerary for a trip to {destination or 'the destination'} over "
        f"{days} day(s) ({dates}).\n"
        f"Travel style: {style or 'any'}. "
        f"Transport preference: {transport_pref or 'any'}. "
        f"Accommodation preference: {accommodation_pref or 'any'}.\n"
        f"{budget_line}\n"
        f"{facts_block}"
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


def flag_cost_outliers(days: list[DraftDay], facts: dict | None) -> None:
    """Mark items whose est_cost looks implausible for this destination.

    Mutates each DraftItem's ``flags`` in place (adds "cost_high" and/or
    "cost_low"). This checks the model's number against a coarse per-category
    share of the destination's OWN recorded average daily budget — it is a
    plausibility check against a domain prior, not a verification that any
    claimed venue exists (the catalogue has no venue-level data to check
    against). A flag means "unusual price for this destination's budget
    tier," nothing stronger.

    No-op when ``facts`` is falsy or has no avg_daily_budget — an unknown
    destination has nothing to check against.
    """
    if not facts or not facts.get("avg_daily_budget"):
        return
    daily_budget = Decimal(str(facts["avg_daily_budget"]))

    for day in days:
        for item in day.items:
            share = CATEGORY_DAILY_SHARE.get(item.category, Decimal("0.15"))
            expected = daily_budget * share
            if expected <= 0 or item.est_cost <= 0:
                continue
            if item.est_cost > expected * 3:
                item.flags.append("cost_high")
            elif item.est_cost < expected * Decimal("0.15"):
                item.flags.append("cost_low")


def _season_months(best_season: str) -> set[int] | None:
    """Parse a 'Nov-Feb' style range into the set of month numbers (1-12) it
    covers, wrapping the year boundary when the end month precedes the start.
    Returns None for anything that doesn't parse as two 3-letter months.
    """
    if not best_season or "-" not in best_season:
        return None
    start_s, _, end_s = best_season.partition("-")
    try:
        start = _MONTH_ABBR.index(start_s.strip()[:3].lower()) + 1
        end = _MONTH_ABBR.index(end_s.strip()[:3].lower()) + 1
    except ValueError:
        return None
    if start <= end:
        return set(range(start, end + 1))
    return set(range(start, 13)) | set(range(1, end + 1))


def check_season_mismatch(facts: dict | None, start_date, end_date) -> str | None:
    """A plan-level advisory when the trip's dates fall outside the
    destination's recorded best season. Purely informational — this never
    blocks generation, it only tells the traveller to sanity-check weather,
    closures, and pricing themselves. Returns None when there isn't enough
    information (no facts, no recorded season, or no trip dates) to say
    anything, or when the dates DO fall inside the season.
    """
    if not facts or not facts.get("best_season") or not (start_date and end_date):
        return None
    months = _season_months(facts["best_season"])
    if not months:
        return None

    trip_months: set[int] = set()
    d = start_date
    # Trips are days, not years — bounded, so a day-by-day walk is fine.
    while d <= end_date:
        trip_months.add(d.month)
        d += timedelta(days=1)

    if trip_months and not (trip_months & months):
        name = facts.get("name", "this destination")
        return (
            f"These dates fall outside {name}'s usual best season "
            f"({facts['best_season']}) — the plan may not reflect real "
            "seasonal weather, closures, or pricing."
        )
    return None


# Catalogue first; general knowledge only when labelled as such. Plans are
# still budget-checked server-side either way.
GROUNDING_RULE = (
    "Prefer the DATA below: it is TripBuddy's own catalogue with real daily "
    "costs. For places or facts not in DATA you may use general knowledge, but "
    "say plainly that those figures are rough estimates, not from TripBuddy's "
    "catalogue, and never invent exact prices, timings or venue names."
)


def build_assistant_prompt(context: dict, question: str) -> str:
    """Prompt for the trip assistant: answer from ``context`` only.

    ``context`` is plain data built in ai_service (trip, budget so far, the
    destination catalogue). The model replies with JSON: an ``answer`` and,
    only if the user wants a plan, a ``plan`` in the itinerary shape — which
    the server then budget-checks like any other draft.
    """
    return (
        "You are TripBuddy's trip assistant for budget travellers in India. "
        f"{GROUNDING_RULE} Amounts are INR.\n"
        f"DATA: {json.dumps(context, default=str, separators=(',', ':'))}\n\n"
        f"QUESTION: {question}\n\n"
        "Respond with STRICT JSON ONLY. Shape: "
        '{"answer": str, "plan": null or {"days": [{"items": [{"title": str, '
        f'"category": one of {list(VALID_CATEGORIES)}, "est_cost": number, '
        '"location": str, "notes": str}]}]}}\n'
        'Set "plan" only when the user asks for a plan/itinerary; the total '
        "est_cost must fit the trip budget. Do not take bookings or payments; "
        "point to sites like IRCTC, RedBus or MakeMyTrip instead."
    )


def parse_assistant_reply(raw: str) -> tuple[str, list[DraftDay] | None]:
    """(answer, days-or-None). Raises ItineraryParseError on a malformed reply."""
    try:
        data = json.loads(_strip_fences(raw))
    except (json.JSONDecodeError, TypeError) as exc:
        raise ItineraryParseError(f"Not valid JSON: {exc}") from exc
    if not isinstance(data, dict) or not str(data.get("answer", "")).strip():
        raise ItineraryParseError("Reply has no answer.")
    plan = data.get("plan")
    days = parse_itinerary(json.dumps(plan)) if plan else None
    return str(data["answer"]).strip(), days


CHAT_HISTORY_LIMIT = 10

# Bounds for what the model may claim about the trip; anything outside is
# dropped rather than trusted.
_CONTEXT_INT_BOUNDS = {"days": (1, 60), "travellers": (1, 20), "budget": (0, 10_000_000)}


def build_chat_messages(data: dict, history: list[tuple[str, str]], message: str) -> list[dict]:
    """OpenAI-style messages for one chat turn.

    ``data`` is the grounding (catalogue, linked trip, context so far) built
    in ai_service; ``history`` is (role, content) pairs, oldest first, already
    trimmed to CHAT_HISTORY_LIMIT. The reply is strict JSON so the server can
    validate places against the catalogue and budget-check any plan.
    """
    system = (
        "You are TripBuddy's travel assistant for budget travellers in India. "
        f"{GROUNDING_RULE} Amounts are INR. Be concise and practical.\n"
        f"DATA: {json.dumps(data, default=str, separators=(',', ':'))}\n\n"
        "Respond with STRICT JSON ONLY, no markdown fences, in this shape:\n"
        '{"title": str (3-6 words naming the trip idea),\n'
        ' "answer": str (markdown: short headings, bullet lists, bold key numbers),\n'
        ' "context": {"destination": str|null, "days": int|null, '
        '"travellers": int|null, "budget": int|null (total INR for the group)},\n'
        ' "places": [slug] (catalogue slugs you mention, max 6),\n'
        ' "plan": null or {"days": [{"items": [{"title": str, "category": one of '
        f'{list(VALID_CATEGORIES)}, "est_cost": number, "location": str, '
        '"notes": str}]}]},\n'
        ' "follow_up": str|null (one short clarifying question)}\n'
        'Fill "context" from the whole conversation. Set "plan" only when the '
        "user wants an itinerary; keep its total est_cost within the budget. "
        "Only use slugs from DATA.destinations or DATA.other_destinations "
        "(the latter lists the rest of the catalogue by slug). Do not take bookings "
        "or payments; point to sites like IRCTC, RedBus or MakeMyTrip instead."
    )
    return (
        [{"role": "system", "content": system}]
        + [{"role": role, "content": content} for role, content in history]
        + [{"role": "user", "content": message}]
    )


def _clean_context(raw) -> dict:
    """Keep only well-typed, in-range context values; drop the rest."""
    if not isinstance(raw, dict):
        return {}
    clean = {}
    destination = raw.get("destination")
    if isinstance(destination, str) and destination.strip():
        clean["destination"] = destination.strip()[:60]
    for key, (low, high) in _CONTEXT_INT_BOUNDS.items():
        try:
            value = int(raw.get(key))
        except (TypeError, ValueError):
            continue
        if low <= value <= high:
            clean[key] = value
    return clean


def parse_chat_reply(raw: str) -> dict:
    """{title, answer, context, places, days, follow_up} from the model's JSON.

    Raises ItineraryParseError when there is no usable answer. ``places`` is
    returned as given (strings only); the caller checks them against the
    catalogue. ``days`` is parsed itinerary days, or None.
    """
    try:
        data = json.loads(_strip_fences(raw))
    except (json.JSONDecodeError, TypeError) as exc:
        raise ItineraryParseError(f"Not valid JSON: {exc}") from exc
    # The model occasionally wraps the object in a one-item list.
    if isinstance(data, list) and data and isinstance(data[0], dict):
        data = data[0]
    if not isinstance(data, dict) or not str(data.get("answer", "")).strip():
        raise ItineraryParseError("Reply has no answer.")

    places = data.get("places") if isinstance(data.get("places"), list) else []
    follow_up = data.get("follow_up")
    plan = data.get("plan")
    return {
        "title": str(data.get("title") or "").strip()[:120],
        "answer": str(data["answer"]).strip(),
        "context": _clean_context(data.get("context")),
        "places": [p for p in places if isinstance(p, str)][:6],
        "days": parse_itinerary(json.dumps(plan)) if plan else None,
        "follow_up": follow_up.strip()[:300] if isinstance(follow_up, str) and follow_up.strip() else None,
    }
