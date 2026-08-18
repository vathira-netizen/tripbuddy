"use client";

import { useState } from "react";

import { ApiError } from "@/lib/api";
import {
  avatarTint,
  BUDGET_STYLE_LABELS,
  BuddyCandidate,
  initials,
  sendConnectionRequest,
} from "@/lib/buddies";

/**
 * One ranked candidate.
 *
 * The only location shown is `area_label` and the coarse `distance_bucket` the
 * API sent — there is no coordinate to render and none is requested.
 */
export function BuddyCard({
  candidate,
  onConnected,
}: {
  candidate: BuddyCandidate;
  onConnected?: (candidate: BuddyCandidate) => void;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setState("sending");
    setError(null);
    try {
      await sendConnectionRequest(candidate.supabase_user_id);
      setState("sent");
      onConnected?.(candidate);
    } catch (err) {
      setState("idle");
      if (err instanceof ApiError) {
        const data = err.data as { detail?: string } | undefined;
        // 409 means a connection already exists — the detail explains which.
        setError(data?.detail ?? "Could not send the request.");
      } else {
        setError("Could not send the request.");
      }
    }
  };

  return (
    <article className="card group flex flex-col overflow-hidden">
      {/* Gradient banner with a floating match badge (MMT-style). */}
      <div className="brand-gradient relative h-16">
        <span className="absolute right-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-xs font-bold text-indigo-700 shadow-sm">
          {candidate.score}% match
        </span>
      </div>

      <div className="-mt-8 flex flex-1 flex-col gap-4 px-4 pb-4">
        <header className="flex items-end gap-3">
          <span
            aria-hidden="true"
            className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-lg font-bold shadow-md ring-4 ring-white ${avatarTint(
              candidate.supabase_user_id,
            )}`}
          >
            {initials(candidate.display_name)}
          </span>
          <div className="min-w-0 flex-1 pb-1">
            <h3 className="truncate text-base font-bold">{candidate.display_name}</h3>
            <p className="truncate text-sm text-black/60 dark:text-white/60">
              📍 {candidate.area_label || "Area not set"}
              {" · "}
              {candidate.distance_bucket}
            </p>
            <p className="mt-0.5 text-xs text-black/60 dark:text-white/60">
              {[
                candidate.age_band,
                BUDGET_STYLE_LABELS[candidate.budget_style] ?? null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </header>

        <ScoreBar score={candidate.score} name={candidate.display_name} />

      {candidate.explanation.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {candidate.explanation.map((reason) => (
            <li
              key={reason.component}
              title={`Contributes ${reason.contribution.toFixed(0)} of ${
                candidate.score
              } points`}
              className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
            >
              {reason.label}
            </li>
          ))}
        </ul>
      )}

      {candidate.interests.length > 0 && (
        <p className="text-xs capitalize text-black/60 dark:text-white/60">
          {candidate.interests.slice(0, 5).join(" · ")}
        </p>
      )}

      <div className="mt-auto space-y-2">
        {error && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={connect}
          disabled={state !== "idle"}
          className="inline-flex w-full items-center justify-center rounded-full bg-gradient-to-r from-indigo-600 to-indigo-500 px-4 py-2.5 text-sm font-bold text-white shadow-md shadow-indigo-600/25 transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state === "sent"
            ? "✓ Request sent"
            : state === "sending"
              ? "Sending…"
              : "Connect"}
        </button>
      </div>
      </div>
    </article>
  );
}

/**
 * The 0–100 compatibility score.
 *
 * Rendered as a meter rather than a progress bar: it is a measurement within a
 * known range, not the progress of a task.
 */
function ScoreBar({ score, name }: { score: number; name: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-black/70 dark:text-white/70">Match</span>
        <span className="font-semibold tabular-nums">{score}%</span>
      </div>
      <div
        role="meter"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Compatibility with ${name}`}
        className="h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/15"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-indigo-400 transition-[width]"
          style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
        />
      </div>
    </div>
  );
}
