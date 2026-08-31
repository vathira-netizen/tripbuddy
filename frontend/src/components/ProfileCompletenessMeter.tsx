/** Mirrors the backend checklist in apps/accounts/serializers.py ProfileSerializer.COMPLETENESS_CHECKLIST. */
export interface CompletenessInput {
  avatar_url: string;
  bio: string;
  travel_styles: string[];
  languages: string[];
  interests: string[];
  daily_budget: string; // "" counts as unset
  upi_vpa: string;
}

const CHECKLIST: { field: keyof CompletenessInput; label: string }[] = [
  { field: "avatar_url", label: "a profile photo" },
  { field: "bio", label: "a bio" },
  { field: "travel_styles", label: "your travel style" },
  { field: "languages", label: "languages you speak" },
  { field: "interests", label: "travel interests" },
  { field: "daily_budget", label: "a daily budget" },
  { field: "upi_vpa", label: "a UPI ID for settling up" },
];

export function computeCompleteness(values: CompletenessInput) {
  const missing = CHECKLIST.filter(({ field }) => {
    const v = values[field];
    return Array.isArray(v) ? v.length === 0 : !v;
  }).map((c) => c.label);
  const percent = Math.round(((CHECKLIST.length - missing.length) / CHECKLIST.length) * 100);
  return { percent, missing };
}

/** Live-updating strength bar for the profile edit form — recomputed from form state, not a save round trip. */
export default function ProfileCompletenessMeter({ values }: { values: CompletenessInput }) {
  const { percent, missing } = computeCompleteness(values);

  const message =
    percent === 100
      ? "Your profile is complete!"
      : missing.includes("a profile photo") && missing.includes("a bio")
        ? "Add your bio and profile photo to get 3x more buddy matches."
        : `Add ${missing[0]} to reach 100%.`;

  return (
    <div className="space-y-1.5 rounded-2xl border border-line bg-surface-alt p-4">
      <div className="flex items-center justify-between text-xs">
        <span className="font-bold text-brand-teal">{percent}% complete</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-line">
        <div
          className={`h-full rounded-full transition-[width] ${
            percent === 100 ? "bg-brand-teal" : "bg-brand-coral"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-xs text-text-subtle">{message}</p>
    </div>
  );
}
