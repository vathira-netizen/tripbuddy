"""The one place that talks to the LLM. Everything network-facing lives here.

``generate_itinerary`` builds a prompt (apps.trips.llm), calls an
OpenAI-compatible chat endpoint server-side, parses the JSON, and validates it
against the trip's budget — retrying once on a parse failure and once more to
revise an over-budget plan. The key is read from settings and never leaves the
server.

Tests monkeypatch ``call_llm`` so the suite never makes a live call.
"""

import logging

import requests
from django.conf import settings

from apps.trips.llm import (
    ItineraryParseError,
    build_prompt,
    parse_itinerary,
    validate_budget,
)

logger = logging.getLogger(__name__)


class LLMConfigError(RuntimeError):
    """The server has no API key / provider configured."""


class LLMError(RuntimeError):
    """The provider call failed or returned an unusable response."""


def call_llm(prompt: str) -> str:
    """POST a single-message chat completion and return the raw text content.

    Provider-agnostic: works against any OpenAI-compatible endpoint (Groq by
    default). This is the seam the tests replace.
    """
    if not settings.GROQ_API_KEY:
        raise LLMConfigError("No LLM API key configured.")

    url = f"{settings.LLM_BASE_URL.rstrip('/')}/chat/completions"
    payload = {
        "model": settings.LLM_MODEL,
        "messages": [{"role": "user", "content": prompt}],
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


def generate_itinerary(trip, params: dict) -> dict:
    """Draft a budget-validated itinerary for ``trip`` — NOT persisted.

    Returns a JSON-serializable dict: {days, budget, over_budget, target,
    provider, model}. Raises LLMConfigError / LLMError for the view to map.
    """
    budget = trip.target_amount  # Decimal or None
    dates = (
        f"{trip.start_date} to {trip.end_date}"
        if trip.start_date and trip.end_date
        else "flexible dates"
    )
    destination = getattr(trip.destination, "name", "") if trip.destination_id else ""

    prompt = build_prompt(
        destination=destination,
        budget=budget,
        nights=trip.nights,
        dates=dates,
        style=params.get("style", ""),
        transport_pref=params.get("transport_pref", ""),
        accommodation_pref=params.get("accommodation_pref", ""),
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

    return {
        "days": [day.to_dict() for day in days],
        "target": str(budget) if budget is not None else None,
        "total": str(report["total"]),
        "over_budget": report["over_budget"],
        "per_category": {k: str(v) for k, v in report["per_category"].items()},
        "offending_items": [item.to_dict() for item in report["offending_items"]],
        "provider": settings.LLM_PROVIDER,
        "model": settings.LLM_MODEL,
    }
