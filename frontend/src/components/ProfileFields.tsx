"use client";

import {
  AGE_BANDS,
  BUDGET_STYLES,
  GENDERS,
  INTEREST_TAGS,
  LANGUAGES,
} from "@/lib/vocab";
import { Input, Select, TagPicker } from "@/components/ui";

export type ProfileFieldValues = {
  display_name: string;
  age_band: string;
  gender: string;
  languages: string[];
  interests: string[];
  budget_style: string;
  daily_budget: string; // kept as string for the input; parsed on submit
};

/** Field names whose value is a tag list. */
type TagField = "languages" | "interests";

/**
 * Setter for one profile field. Accepts an updater function as well as a plain
 * value: the tag pickers fire several toggles before React re-renders, and a
 * plain value would be computed from stale state, silently dropping all but the
 * last selection.
 */
export type FieldSetter = <K extends keyof ProfileFieldValues>(
  key: K,
  value: ProfileFieldValues[K] | ((prev: ProfileFieldValues[K]) => ProfileFieldValues[K]),
) => void;

/** Applies a FieldSetter value (plain or updater) against the previous state. */
export function applyFieldUpdate<K extends keyof ProfileFieldValues>(
  previous: ProfileFieldValues,
  key: K,
  value: ProfileFieldValues[K] | ((prev: ProfileFieldValues[K]) => ProfileFieldValues[K]),
): ProfileFieldValues {
  const next =
    typeof value === "function"
      ? (value as (prev: ProfileFieldValues[K]) => ProfileFieldValues[K])(previous[key])
      : value;
  return { ...previous, [key]: next };
}

export const emptyProfileFields: ProfileFieldValues = {
  display_name: "",
  age_band: "",
  gender: "",
  languages: [],
  interests: [],
  budget_style: "",
  daily_budget: "",
};

/** The identity + preference fields shared by onboarding and profile edit. */
export function IdentityFields({
  values,
  errors,
  set,
}: {
  values: ProfileFieldValues;
  errors: Record<string, string>;
  set: FieldSetter;
}) {
  return (
    <>
      <Input
        label="Display name"
        name="display_name"
        value={values.display_name}
        onChange={(e) => set("display_name", e.target.value)}
        error={errors.display_name}
        required
      />
      <Select
        label="Age band"
        name="age_band"
        value={values.age_band}
        onChange={(e) => set("age_band", e.target.value)}
        error={errors.age_band}
        required
      >
        <option value="">Select…</option>
        {AGE_BANDS.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </Select>
      <Select
        label="Gender"
        name="gender"
        value={values.gender}
        onChange={(e) => set("gender", e.target.value)}
        error={errors.gender}
        required
      >
        <option value="">Select…</option>
        {GENDERS.map((g) => (
          <option key={g.value} value={g.value}>
            {g.label}
          </option>
        ))}
      </Select>
    </>
  );
}

export function PreferenceFields({
  values,
  errors,
  set,
}: {
  values: ProfileFieldValues;
  errors: Record<string, string>;
  set: FieldSetter;
}) {
  function toggle(list: TagField, value: string) {
    // Functional update: reads the latest list, so rapid toggles don't clobber
    // each other.
    set(list, (previous) =>
      previous.includes(value)
        ? previous.filter((v) => v !== value)
        : [...previous, value],
    );
  }

  return (
    <>
      <TagPicker
        legend="Languages you speak"
        options={LANGUAGES}
        selected={values.languages}
        onToggle={(v) => toggle("languages", v)}
        error={errors.languages}
      />
      <TagPicker
        legend="Travel interests"
        options={INTEREST_TAGS}
        selected={values.interests}
        onToggle={(v) => toggle("interests", v)}
        error={errors.interests}
      />
      <Select
        label="Budget style"
        name="budget_style"
        value={values.budget_style}
        onChange={(e) => set("budget_style", e.target.value)}
        error={errors.budget_style}
        required
      >
        <option value="">Select…</option>
        {BUDGET_STYLES.map((b) => (
          <option key={b.value} value={b.value}>
            {b.label}
          </option>
        ))}
      </Select>
      <Input
        label="Typical daily budget (₹)"
        name="daily_budget"
        type="number"
        inputMode="numeric"
        min={0}
        value={values.daily_budget}
        onChange={(e) => set("daily_budget", e.target.value)}
        error={errors.daily_budget}
        required
      />
    </>
  );
}
