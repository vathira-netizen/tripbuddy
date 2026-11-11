"""The one place that talks to the LLM. Everything network-facing lives here.

``generate_itinerary`` builds a prompt (apps.trips.llm), calls an
OpenAI-compatible chat endpoint server-side, parses the JSON, and validates it
against the trip's budget — retrying once on a parse failure and once more to
revise an over-budget plan. The key is read from settings and never leaves the
server.

Phase 6.1: the draft returned to the frontend also carries a plan-level
``disclaimer`` (always — no plan's venues are verified), zero or more
``advisories`` (destination-level cautions, e.g. an off-season trip), and a
``grounded`` flag (whether the destination catalogue had facts to ground the
prompt in at all). Per-item ``flags`` come from apps.trips.llm.flag_cost_outliers.

Tests monkeypatch ``call_llm`` so the suite never makes a live call.
"""

import json
import logging
import time
from decimal import Decimal

import requests
from django.conf import settings

from apps.budgets import services as budget_services
from apps.destinations.models import Destination
from apps.trips.models import ChatMessage
from apps.trips.llm import (
    ItineraryParseError,
    CHAT_HISTORY_LIMIT,
    build_assistant_prompt,
    build_chat_messages,
    build_prompt,
    check_season_mismatch,
    flag_cost_outliers,
    parse_assistant_reply,
    parse_chat_reply,
    parse_itinerary,
    validate_budget,
)

logger = logging.getLogger(__name__)

# Shown for every draft, grounded or not: nothing here has been checked
# against a live venue database, so the traveller should treat named places
# as suggestions to confirm, not booked facts.
ITINERARY_DISCLAIMER = (
    "AI-suggested plan. Costs are sanity-checked against this destination's "
    "typical spend, but specific venues aren't verified against a live "
    "database — confirm names, hours, and prices before booking."
)


class LLMConfigError(RuntimeError):
    """The server has no API key / provider configured."""


class LLMError(RuntimeError):
    """The provider call failed or returned an unusable response."""


def call_llm(prompt: str | list[dict]) -> str:
    """POST a chat completion and return the raw text content.

    ``prompt`` is either one user message or a full OpenAI-style ``messages``
    list (system + history), as the chat uses. Provider-agnostic: works
    against any OpenAI-compatible endpoint (Groq by default). This is the
    seam the tests replace.
    """
    if not settings.GROQ_API_KEY:
        raise LLMConfigError("No LLM API key configured.")

    url = f"{settings.LLM_BASE_URL.rstrip('/')}/chat/completions"
    messages = [{"role": "user", "content": prompt}] if isinstance(prompt, str) else prompt
    payload = {
        "model": settings.LLM_MODEL,
        "messages": messages,
        # Low temperature + JSON mode: we want a stable, parseable plan.
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
    }
    headers = {
        "Authorization": f"Bearer {settings.GROQ_API_KEY}",
        "Content-Type": "application/json",
    }

    try:
        logger.info(
            "LLM request: provider=%s model=%s url=%s",
            settings.LLM_PROVIDER, settings.LLM_MODEL, url,
        )
        response = requests.post(
            url, json=payload, headers=headers, timeout=settings.LLM_TIMEOUT
        )
        if response.status_code == 429:
            # Free-tier tokens-per-minute limit: wait what the provider asks
            # (capped) and retry once rather than failing the user's message.
            # ponytail: one blocking retry; a queue if traffic ever grows.
            wait = min(float(response.headers.get("retry-after") or 5), 10)
            logger.warning("LLM rate-limited; retrying in %.1fs", wait)
            time.sleep(wait)
            response = requests.post(
                url, json=payload, headers=headers, timeout=settings.LLM_TIMEOUT
            )
        response.raise_for_status()
        data = response.json()
        content = data["choices"][0]["message"]["content"]
        logger.info("LLM response received: %d chars", len(content))
        return content
    except requests.Timeout as exc:
        logger.error("LLM call timed out after %ss", settings.LLM_TIMEOUT)
        raise LLMError("The AI service timed out. Try again.") from exc
    except requests.HTTPError as exc:
        logger.error(
            "LLM HTTP error: status=%s body=%s",
            exc.response.status_code if exc.response is not None else "?",
            exc.response.text[:500] if exc.response is not None else "?",
        )
        raise LLMError("The AI provider returned an error.") from exc
    except (requests.RequestException, KeyError, ValueError) as exc:
        logger.error("LLM call failed: %s: %s", type(exc).__name__, exc)
        raise LLMError("The AI provider is unavailable.") from exc


def _generate_and_parse(prompt: str):
    """One call with a single parse-failure retry (per the spec's pitfall note)."""
    raw = call_llm(prompt)
    try:
        return parse_itinerary(raw)
    except ItineraryParseError:
        logger.info("First parse failed; retrying once with a stricter reminder.")
        raw = call_llm(prompt + "\n\nReturn STRICT JSON ONLY. No prose, no markdown.")
        return parse_itinerary(raw)


def _destination_facts(trip) -> dict | None:
    """The trip's destination, as the plain-data facts apps.trips.llm grounds
    the prompt in. None when the trip has no destination set — there is
    nothing to ground on, and the draft is returned with ``grounded: False``.
    """
    dest = trip.destination
    if dest is None:
        return None
    return {
        "name": dest.name,
        "avg_daily_budget": dest.avg_daily_budget,
        "budget_tier": dest.budget_tier,
        "interest_tags": list(dest.interest_tags or []),
        "best_season": dest.best_season,
    }


def generate_itinerary(trip, params: dict) -> dict:
    """Draft a budget-validated itinerary for ``trip`` — NOT persisted.

    Returns a JSON-serializable dict: {days, target, total, over_budget,
    per_category, offending_items, provider, model, grounded, advisories,
    disclaimer}. Raises LLMConfigError / LLMError for the view to map.
    """
    budget = trip.target_amount  # Decimal or None
    dates = (
        f"{trip.start_date} to {trip.end_date}"
        if trip.start_date and trip.end_date
        else "flexible dates"
    )
    destination = getattr(trip.destination, "name", "") if trip.destination_id else ""
    facts = _destination_facts(trip)

    prompt = build_prompt(
        destination=destination,
        budget=budget,
        nights=trip.nights,
        dates=dates,
        style=params.get("style", ""),
        transport_pref=params.get("transport_pref", ""),
        accommodation_pref=params.get("accommodation_pref", ""),
        facts=facts,
    )

    days = _generate_and_parse(prompt)
    report = validate_budget(days, budget)

    # One revision attempt if the model blew the budget.
    if report["over_budget"]:
        revise = (
            prompt
            + f"\n\nThat plan totalled {report['total']}, over the budget of "
            f"{budget}. Produce a cheaper plan within budget, same JSON shape."
        )
        try:
            revised = _generate_and_parse(revise)
            revised_report = validate_budget(revised, budget)
            # Keep the revision only if it actually helped.
            if revised_report["total"] <= report["total"]:
                days, report = revised, revised_report
        except LLMError:
            pass  # keep the first (flagged) plan rather than failing outright

    # Plausibility pass — mutates each item's .flags in place. Runs on the
    # final plan (post-revision, if a revision was kept) so flags reflect
    # what's actually being returned.
    flag_cost_outliers(days, facts)
    season_advisory = check_season_mismatch(facts, trip.start_date, trip.end_date)

    return {
        "days": [day.to_dict() for day in days],
        "target": str(budget) if budget is not None else None,
        "total": str(report["total"]),
        "over_budget": report["over_budget"],
        "per_category": {k: str(v) for k, v in report["per_category"].items()},
        "offending_items": [item.to_dict() for item in report["offending_items"]],
        "provider": settings.LLM_PROVIDER,
        "model": settings.LLM_MODEL,
        "grounded": facts is not None,
        "advisories": [season_advisory] if season_advisory else [],
        "disclaimer": ITINERARY_DISCLAIMER,
    }


def ask_assistant(trip, question: str) -> dict:
    """Answer a question from the trip, its budget so far and the catalogue.

    If the reply carries a plan it is re-summed against the trip budget, same
    as generate_itinerary — an over-budget plan is flagged, never hidden.
    Raises LLMConfigError / LLMError for the view to map.
    """
    about = f"{question} {getattr(trip.destination, 'name', '')}"
    context = {
        **_trip_data(trip),
        **_catalogue_data(list(Destination.objects.all()), about),
    }
    prompt = build_assistant_prompt(context, question)
    try:
        answer, days = parse_assistant_reply(call_llm(prompt))
    except ItineraryParseError:
        answer, days = parse_assistant_reply(
            call_llm(prompt + "\n\nReturn STRICT JSON ONLY. No prose, no markdown.")
        )

    return {
        "answer": answer,
        "plan": _plan_payload(days, trip.target_amount) if days else None,
        "provider": settings.LLM_PROVIDER,
    }


def _trip_data(trip) -> dict:
    """The trip and its spend so far, as plain data for a prompt."""
    items = list(trip.budget_items.all())
    return {
        "trip": {
            "title": trip.title,
            "destination": getattr(trip.destination, "name", None),
            "nights": trip.nights,
            "start_date": trip.start_date,
            "end_date": trip.end_date,
        },
        "budget": {
            **budget_services.running_total_vs_target(items, trip.target_amount),
            "by_category": budget_services.category_totals(items),
        },
    }


CATALOGUE_DETAIL_LIMIT = 12


def _catalogue_data(destinations, text: str) -> dict:
    """The catalogue as prompt data: full rows for destinations ``text`` is
    about (by name, then state), padded with the cheapest; a slug-only index
    for the rest so the model still knows they exist.

    Sending every row in full stopped fitting Groq's free-tier tokens-per-
    minute limit once the catalogue grew past ~40 places.
    ponytail: substring matching; real retrieval if the catalogue gets large.
    """
    text = text.lower()
    by_name = [d for d in destinations if d.name.lower() in text or d.slug.replace("-", " ") in text]
    by_state = [d for d in destinations if d.state and d.state.lower() in text and d not in by_name]
    cheapest = sorted(
        (d for d in destinations if d not in by_name and d not in by_state),
        key=lambda d: d.avg_daily_budget,
    )
    detail = (by_name + by_state + cheapest)[:CATALOGUE_DETAIL_LIMIT]
    rest = [d for d in destinations if d not in detail]
    return {
        "destinations": ["slug|name|state|INR per person per day|best season|known for"] + [
            f"{d.slug}|{d.name}|{d.state}|{d.avg_daily_budget}|{d.best_season}|{','.join(d.interest_tags)}"
            for d in detail
        ],
        "other_destinations": ", ".join(f"{d.slug} ({d.state})" for d in rest),
    }


def _plan_payload(days, budget) -> dict:
    """A plan re-summed against ``budget`` — over budget is flagged, never hidden."""
    report = validate_budget(days, budget)
    return {
        "days": [day.to_dict() for day in days],
        "target": str(budget) if budget is not None else None,
        "total": str(report["total"]),
        "over_budget": report["over_budget"],
        "offending_items": [i.to_dict() for i in report["offending_items"]],
        "disclaimer": ITINERARY_DISCLAIMER,
    }


def chat_reply(conversation, message: str) -> dict:
    """One chat turn for ``conversation`` (which may be unsaved) — NOT persisted.

    Returns {title, answer, context, data}; ``context`` is merged with what the
    conversation already knew, ``data`` holds places (catalogue entries only),
    a budget-checked plan, and a follow-up question. Raises LLMConfigError /
    LLMError / ItineraryParseError for the view to map.
    """
    recent = []
    if conversation.pk:
        recent = list(conversation.messages.order_by("-created_at", "-id")[:CHAT_HISTORY_LIMIT])[::-1]
    # Past assistant turns go back in the JSON shape the model must reply in;
    # plain-markdown history made it drift out of JSON mode.
    history = [
        (m.role, json.dumps({"answer": m.content}) if m.role == "assistant" else m.content)
        for m in recent
    ]

    # What the chat is about picks which catalogue rows go in full.
    about = " ".join(
        [message, str(conversation.context.get("destination", ""))]
        + [m.content for m in recent if m.role == ChatMessage.Role.USER]
    )
    catalogue = list(Destination.objects.all())
    data = {"context_so_far": conversation.context, **_catalogue_data(catalogue, about)}
    if conversation.trip_id:
        data.update(_trip_data(conversation.trip))

    messages = build_chat_messages(data, history, message)
    try:
        raw = call_llm(messages)
        reply = parse_chat_reply(raw)
    except ItineraryParseError as exc:
        logger.warning("Chat reply unparseable (%s); retrying. Start: %r", exc, raw[:200])
        messages[-1]["content"] += "\n\nReturn STRICT JSON ONLY. No prose, no markdown."
        reply = parse_chat_reply(call_llm(messages))

    context = {**conversation.context, **reply["context"]}
    trip = conversation.trip
    if trip is not None and trip.target_amount is not None:
        budget = trip.target_amount
    elif "budget" in context:
        budget = Decimal(context["budget"])
    else:
        budget = None

    by_slug = {d.slug: d for d in catalogue}
    places = [
        {
            "id": d.id,
            "slug": d.slug,
            "name": d.name,
            "state": d.state,
            "lat": d.point.y,
            "lng": d.point.x,
            "image_url": d.image_url,
            "avg_daily_budget": d.avg_daily_budget,
        }
        for d in (by_slug[s] for s in dict.fromkeys(reply["places"]) if s in by_slug)
    ]

    return {
        "title": reply["title"],
        "answer": reply["answer"],
        "context": context,
        "data": {
            "places": places,
            "plan": _plan_payload(reply["days"], budget) if reply["days"] else None,
            "follow_up": reply["follow_up"],
        },
    }
