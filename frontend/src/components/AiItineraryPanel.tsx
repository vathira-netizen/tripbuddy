"use client";

import { useState } from "react";

import { ApiError } from "@/lib/api";
import { formatINR } from "@/lib/discover";
import { AiDraft, applyItinerary, generateItinerary } from "@/lib/trips";
import { FormError, Input } from "@/components/ui";

/** Lucide `sparkles`, inlined — matches the other icons already inlined across the redesign. */
function Sparkles({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
    </svg>
  );
}

export default function AiItineraryPanel({
  tripId,
  onApplied,
}: {
  tripId: number;
  onApplied: () => void;
}) {
  const [style, setStyle] = useState("");
  const [transport, setTransport] = useState("");
  const [accommodation, setAccommodation] = useState("");
  const [addToBudget, setAddToBudget] = useState(false);

  const [draft, setDraft] = useState<AiDraft | null>(null);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    setDraft(null);
    try {
      const result = await generateItinerary(tripId, {
        style,
        transport_pref: transport,
        accommodation_pref: accommodation,
      });
      setDraft(result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setError("AI generation isn't configured on the server yet.");
      } else if (err instanceof ApiError && err.status === 502) {
        const detail =
          typeof err.data === "object" && err.data && "detail" in err.data
            ? String((err.data as { detail?: unknown }).detail)
            : null;
        setError(detail || "The AI service is unavailable right now. Try again.");
      } else {
        setError("Couldn't generate a plan right now. Try again.");
      }
    } finally {
      setGenerating(false);
    }
  }

  async function handleApply() {
    if (!draft) return;
    setApplying(true);
    setError(null);
    try {
      await applyItinerary(tripId, draft.days, addToBudget);
      setDraft(null);
      onApplied();
    } catch {
      setError("Couldn't add the plan to your itinerary.");
    } finally {
      setApplying(false);
    }
  }

  const total = draft ? Number(draft.total) : 0;
  const target = draft?.target != null ? Number(draft.target) : null;
  const pct =
    target && target > 0 ? Math.min((total / target) * 100, 100) : total > 0 ? 100 : 0;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-[#d7e0d8] bg-surface-alt p-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-teal text-white">
          <Sparkles className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-[200px] flex-1">
          <h2 className="font-serif text-base text-brand-teal">
            Draft my itinerary with AI
          </h2>
          <p className="mt-0.5 text-xs text-text-subtle">
            Suggest a day-by-day plan from your dates &amp; interests.
          </p>
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-brand-coral px-5 py-2 text-sm font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {generating && (
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="h-4 w-4 animate-spin"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
            >
              <circle cx="12" cy="12" r="9" strokeOpacity={0.25} />
              <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
            </svg>
          )}
          {generating ? "Drafting…" : "Generate"}
        </button>
      </div>

      {generating && (
        <p role="status" className="text-xs text-text-subtle">
          Drafting your personalized itinerary with AI…
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        <Input
          label="Style"
          value={style}
          onChange={(e) => setStyle(e.target.value)}
          placeholder="e.g. relaxed"
        />
        <Input
          label="Transport"
          value={transport}
          onChange={(e) => setTransport(e.target.value)}
          placeholder="e.g. train"
        />
        <Input
          label="Stay"
          value={accommodation}
          onChange={(e) => setAccommodation(e.target.value)}
          placeholder="e.g. hostel"
        />
      </div>

      {error && <FormError message={error} />}

      {draft && (
        <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
          {/* Budget bar */}
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-text-subtle">
                Estimated total: {formatINR(total)}
                {target != null && ` of ${formatINR(target)}`}
              </span>
              {draft.over_budget && (
                <span className="font-semibold text-brand-coral-ink">Over budget</span>
              )}
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-line">
              <div
                className={`h-full ${draft.over_budget ? "bg-brand-coral" : "bg-brand-teal"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {draft.over_budget && (
            <p className="rounded-xl bg-brand-coral-tint px-3 py-2 text-xs text-brand-coral-ink">
              This plan exceeds the trip budget. The priciest items are flagged
              below — trim them, or add it anyway and adjust on the board.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {draft.days.map((day) => (
              <div
                key={day.day_index}
                className="space-y-2 rounded-xl border border-line p-3"
              >
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
                  Day {day.day_index + 1}
                </h3>
                <ul className="space-y-2">
                  {day.items.map((item, i) => {
                    const offending = draft.offending_items.some(
                      (o) => o.title === item.title && o.est_cost === item.est_cost,
                    );
                    return (
                      <li
                        key={i}
                        className={`rounded-lg border p-2 text-sm ${
                          offending
                            ? "border-brand-coral/40 bg-brand-coral-tint/60"
                            : "border-line"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-medium">{item.title}</span>
                          <span className="shrink-0 text-xs text-text-subtle">
                            {formatINR(Number(item.est_cost))}
                          </span>
                        </div>
                        <p className="text-xs text-text-subtle">
                          {item.category}
                          {item.location && ` · ${item.location}`}
                        </p>
                        {item.notes && (
                          <p className="mt-1 text-xs text-text-subtle">{item.notes}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleApply}
              disabled={applying}
              className="rounded-full bg-brand-teal px-4 py-2 text-sm font-bold text-background transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {applying ? "Adding…" : "Add to my itinerary"}
            </button>
            <label className="flex items-center gap-2 text-xs text-text-muted">
              <input
                type="checkbox"
                checked={addToBudget}
                onChange={(e) => setAddToBudget(e.target.checked)}
              />
              Also add costs to the budget
            </label>
          </div>
        </div>
      )}
    </section>
  );
}
