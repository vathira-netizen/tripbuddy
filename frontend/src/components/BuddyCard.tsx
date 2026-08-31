"use client";

import { useState } from "react";
import { toast } from "sonner";

import { ApiError } from "@/lib/api";
import { BuddyCandidate, initials, sendConnectionRequest } from "@/lib/buddies";
import TravellerProfileModal from "@/components/TravellerProfileModal";

/** Lucide `map-pin`, inlined — matches the `heart` icon already inlined on /discover. */
function MapPin({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    >
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

/**
 * One ranked candidate.
 *
 * The only location shown is `area_label` and the coarse `distance_bucket` the
 * API sent — there is no coordinate to render and none is requested.
 *
 * `index` is the card's rank in the results (0 = best match): it drives the
 * coral/teal split between the top card and the rest, and alternates the
 * avatar fill so a page of cards doesn't read as one flat colour.
 */
export function BuddyCard({
  candidate,
  index,
  onConnected,
}: {
  candidate: BuddyCandidate;
  index: number;
  onConnected?: (candidate: BuddyCandidate) => void;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);

  const isTop = index === 0;
  const accent = isTop ? "text-brand-coral" : "text-brand-teal";

  const connect = async () => {
    setState("sending");
    setError(null);
    try {
      await sendConnectionRequest(candidate.supabase_user_id);
      setState("sent");
      toast.success(`Connection request sent to ${candidate.display_name}`);
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
    <article className="flex flex-col gap-3.5 rounded-[20px] border border-line bg-surface p-5">
      <header className="flex items-center gap-3.5">
        <button
          type="button"
          onClick={() => setShowProfile(true)}
          aria-label={`View ${candidate.display_name}'s profile`}
          className="contents"
        >
          <span
            aria-hidden="true"
            className={`grid h-[58px] w-[58px] shrink-0 place-items-center overflow-hidden rounded-full font-serif text-xl font-bold transition hover:brightness-95 ${
              index % 2 === 0
                ? "bg-brand-teal text-background"
                : "bg-brand-coral text-white"
            }`}
          >
            {candidate.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- user-supplied external URL
              <img src={candidate.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              initials(candidate.display_name)
            )}
          </span>
          <div className="min-w-0 flex-1 text-left">
            <h3 className="truncate font-serif text-xl text-brand-teal hover:underline">
              {candidate.display_name}
            </h3>
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-text-subtle">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              {candidate.area_label || "Area not set"} · {candidate.distance_bucket}
            </p>
          </div>
        </button>
        <div className="shrink-0 text-right">
          <div className={`font-serif text-[30px] leading-none ${accent}`}>
            {candidate.score}
            <span className="text-[15px]">%</span>
          </div>
          <div className="text-[10px] uppercase tracking-wider text-text-subtle">
            match
          </div>
        </div>
      </header>

      <ScoreBar score={candidate.score} isTop={isTop} name={candidate.display_name} />

      {candidate.explanation.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {candidate.explanation.map((reason) => (
            <li
              key={reason.component}
              title={`Contributes ${reason.contribution.toFixed(0)} of ${
                candidate.score
              } points`}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                reason.component === "B"
                  ? "bg-brand-coral-tint text-brand-coral-ink"
                  : "bg-surface-alt text-brand-teal"
              }`}
            >
              {reason.label}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto space-y-2">
        {error && (
          <p role="alert" className="text-xs text-brand-coral-ink">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={connect}
          disabled={state !== "idle"}
          className={`mt-0.5 w-full rounded-full py-2.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${
            isTop
              ? "bg-brand-teal text-background hover:brightness-90"
              : "border border-[#c2c8c0] text-brand-teal hover:border-brand-teal"
          }`}
        >
          {state === "sent"
            ? "Request Pending"
            : state === "sending"
              ? "Sending…"
              : "Connect"}
        </button>
      </div>

      {showProfile && (
        <TravellerProfileModal
          supabaseUserId={candidate.supabase_user_id}
          onClose={() => setShowProfile(false)}
        />
      )}
    </article>
  );
}

/**
 * The 0–100 compatibility score.
 *
 * Rendered as a meter rather than a progress bar: it is a measurement within a
 * known range, not the progress of a task.
 */
function ScoreBar({
  score,
  isTop,
  name,
}: {
  score: number;
  isTop: boolean;
  name: string;
}) {
  return (
    <div
      role="meter"
      aria-valuenow={score}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Compatibility with ${name}`}
      className="h-2 w-full overflow-hidden rounded-full bg-line"
    >
      <div
        className={`h-full rounded-full transition-[width] ${
          isTop ? "bg-brand-coral" : "bg-brand-teal"
        }`}
        style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
      />
    </div>
  );
}
