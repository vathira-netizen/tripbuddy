"use client";

import { useState } from "react";

import { formatINR } from "@/lib/discover";
import { AiDraft, applyItinerary, generateItinerary } from "@/lib/trips";

const inputClass =
  "w-full rounded-md border border-black/15 bg-transparent px-2 py-1 text-sm dark:border-white/20";

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
      const status = (err as { status?: number }).status;
      setError(
        status === 503
          ? "AI generation isn't configured on the server yet."
          : "Couldn't generate a plan right now. Try again.",
      );
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
    <section className="space-y-3 rounded-xl border border-black/10 p-4 dark:border-white/10">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Generate with AI</h2>
        <span className="text-xs text-black/40 dark:text-white/40">Draft — review before adding</span>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <input
          value={style}
          onChange={(e) => setStyle(e.target.value)}
          placeholder="Style (e.g. relaxed)"
          aria-label="Travel style"
          className={inputClass}
        />
        <input
          value={transport}
          onChange={(e) => setTransport(e.target.value)}
          placeholder="Transport (e.g. train)"
          aria-label="Transport preference"
          className={inputClass}
        />
        <input
          value={accommodation}
          onChange={(e) => setAccommodation(e.target.value)}
          placeholder="Stay (e.g. hostel)"
          aria-label="Accommodation preference"
          className={inputClass}
        />
      </div>

      <button
        type="button"
        onClick={handleGenerate}
        disabled={generating}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {generating ? "Drafting…" : "Generate itinerary"}
      </button>

      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {draft && (
        <div className="space-y-3">
          {/* Budget bar */}
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-black/60 dark:text-white/60">
                Estimated total: {formatINR(total)}
                {target != null && ` of ${formatINR(target)}`}
              </span>
              {draft.over_budget && (
                <span className="font-semibold text-red-600">Over budget</span>
              )}
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
              <div
                className={`h-full ${draft.over_budget ? "bg-red-500" : "bg-emerald-500"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {draft.over_budget && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              This plan exceeds the trip budget. The priciest items are flagged
              below — trim them, or add it anyway and adjust on the board.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {draft.days.map((day) => (
              <div
                key={day.day_index}
                className="space-y-2 rounded-lg border border-black/10 p-3 dark:border-white/10"
              >
                <h3 className="text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">
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
                        className={`rounded-md border p-2 text-sm ${
                          offending
                            ? "border-red-300 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20"
                            : "border-black/10 dark:border-white/10"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-medium">{item.title}</span>
                          <span className="shrink-0 text-xs text-black/60 dark:text-white/60">
                            {formatINR(Number(item.est_cost))}
                          </span>
                        </div>
                        <p className="text-xs text-black/50 dark:text-white/50">
                          {item.category}
                          {item.location && ` · ${item.location}`}
                        </p>
                        {item.notes && (
                          <p className="mt-1 text-xs text-black/60 dark:text-white/60">
                            {item.notes}
                          </p>
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
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-60"
            >
              {applying ? "Adding…" : "Add to my itinerary"}
            </button>
            <label className="flex items-center gap-2 text-xs text-black/70 dark:text-white/70">
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
