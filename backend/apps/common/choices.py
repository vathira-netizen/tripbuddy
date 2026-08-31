"""Shared vocabularies.

The interest tags and budget tiers are deliberately defined once, here: the
profile tag set and the destination tag set MUST stay identical (Phase 2 seeds
the catalogue from the same list) and the matching engine in Phase 4 compares
them directly.
"""

from django.db import models


class AgeBand(models.TextChoices):
    A_18_20 = "18-20", "18-20"
    A_21_23 = "21-23", "21-23"
    A_24_26 = "24-26", "24-26"
    A_27_30 = "27-30", "27-30"
    A_31_PLUS = "31+", "31+"


# Ordered as above so the matching engine can score "adjacent" bands.
AGE_BAND_ORDER = [c.value for c in AgeBand]


class Gender(models.TextChoices):
    FEMALE = "female", "Female"
    MALE = "male", "Male"
    NON_BINARY = "non_binary", "Non-binary"
    PREFER_NOT_TO_SAY = "prefer_not_to_say", "Prefer not to say"


class BudgetStyle(models.TextChoices):
    BUDGET = "budget", "Budget"
    MID = "mid", "Mid-range"
    COMFORT = "comfort", "Comfort"


# Same three tiers as BudgetStyle: a destination's tier is compared against a
# traveller's style, so the vocabularies must match.
BUDGET_TIER_ORDER = [c.value for c in BudgetStyle]


class BudgetTier(models.TextChoices):
    BUDGET = "budget", "Budget"
    MID = "mid", "Mid-range"
    COMFORT = "comfort", "Comfort"


INTEREST_TAGS = [
    "adventure",
    "beach",
    "backpacking",
    "culture",
    "food",
    "heritage",
    "hiking",
    "history",
    "nature",
    "nightlife",
    "photography",
    "pilgrimage",
    "shopping",
    "trekking",
    "wildlife",
    "wellness",
]

TRAVEL_STYLES = ["backpacking", "luxury", "solo", "weekend"]

LANGUAGES = [
    "assamese",
    "bengali",
    "english",
    "gujarati",
    "hindi",
    "kannada",
    "malayalam",
    "marathi",
    "odia",
    "punjabi",
    "tamil",
    "telugu",
    "urdu",
]
