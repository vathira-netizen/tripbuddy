/**
 * Shared vocabularies. These MUST stay identical to
 * `backend/apps/common/choices.py` — the API validates against the same lists,
 * and Phase 2 seeds destination tags from the same interest set.
 */

export const AGE_BANDS = ["18-20", "21-23", "24-26", "27-30", "31+"] as const;

export const GENDERS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "non_binary", label: "Non-binary" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;

export const BUDGET_STYLES = [
  { value: "budget", label: "Budget" },
  { value: "mid", label: "Mid-range" },
  { value: "comfort", label: "Comfort" },
] as const;

export const INTEREST_TAGS = [
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
] as const;

export const LANGUAGES = [
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
] as const;
