"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { toast } from "sonner";

import {
  avatarTint,
  Badge,
  blockTraveller,
  getTraveller,
  initials,
  profileFacts,
  titleCase,
  TravellerDetail,
} from "@/lib/buddies";
import ReportUserDialog from "@/components/ReportUserDialog";

const BADGE_LABELS: Record<Badge, string> = {
  email_verified: "Email Verified",
  profile_complete: "Profile 100% Complete",
  active_traveller: "Active Traveller",
};

function BadgeIcon({ badge }: { badge: Badge }) {
  const path =
    badge === "email_verified"
      ? "M20 6 9 17l-5-5" // check
      : badge === "profile_complete"
        ? "M12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9 12 2Z" // star
        : "M22 2 11 13M22 2 15 22 11 13 2 9 22 2Z"; // send/active
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}

export default function TravellerProfileModal({
  supabaseUserId,
  onClose,
}: {
  supabaseUserId: string;
  onClose: () => void;
}) {
  const [traveller, setTraveller] = useState<TravellerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showReport, setShowReport] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [blocked, setBlocked] = useState(false);

  async function handleBlock() {
    if (!traveller) return;
    if (!window.confirm(`Block ${traveller.display_name}? You won't see each other again.`)) {
      return;
    }
    setBlocking(true);
    try {
      await blockTraveller(supabaseUserId);
      setBlocked(true);
      toast.success(`Blocked ${traveller.display_name}`);
    } catch {
      toast.error("Couldn't block this traveller. Try again.");
    } finally {
      setBlocking(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    getTraveller(supabaseUserId)
      .then((data) => !cancelled && setTraveller(data))
      .catch(() => !cancelled && setError("Couldn't load this profile."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [supabaseUserId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Traveller profile"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-surface p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-serif text-xl text-brand-teal">Traveller profile</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-text-subtle hover:bg-surface-alt hover:text-brand-teal"
          >
            ✕
          </button>
        </div>

        {loading && <p className="mt-4 text-sm text-text-subtle">Loading…</p>}
        {error && <p className="mt-4 text-sm text-brand-coral-ink">{error}</p>}

        {traveller && (
          <div className="mt-4 space-y-4">
            <div className="flex items-center gap-3">
              {traveller.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- user-supplied external URL
                <img
                  src={traveller.avatar_url}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className={`grid h-14 w-14 shrink-0 place-items-center rounded-full text-lg font-bold ${avatarTint(
                    traveller.supabase_user_id,
                  )}`}
                >
                  {initials(traveller.display_name)}
                </span>
              )}
              <div>
                <p className="font-serif text-lg text-brand-teal">{traveller.display_name}</p>
                <p className="text-xs text-text-subtle">
                  {[traveller.area_label || "Area not set", ...profileFacts(traveller)].join(" · ")}
                </p>
              </div>
            </div>

            {traveller.badges.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {traveller.badges.map((b) => (
                  <span
                    key={b}
                    className="inline-flex items-center gap-1 rounded-full bg-brand-coral-tint px-2.5 py-1 text-[11px] font-semibold text-brand-coral-ink"
                  >
                    <BadgeIcon badge={b} />
                    {BADGE_LABELS[b]}
                  </span>
                ))}
              </div>
            )}

            {traveller.bio && <p className="text-sm">{traveller.bio}</p>}

            {traveller.travel_styles.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-brand-teal">
                  Travel style
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {traveller.travel_styles.map((s) => (
                    <span
                      key={s}
                      className="rounded-full border border-line-input px-2.5 py-1 text-xs capitalize text-brand-teal"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {traveller.interests.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-brand-teal">
                  Interests
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {traveller.interests.map((i) => (
                    <span
                      key={i}
                      className="rounded-full border border-line-input px-2.5 py-1 text-xs text-brand-teal"
                    >
                      {titleCase(i)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {traveller.languages.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-brand-teal">
                  Languages
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {traveller.languages.map((l) => (
                    <span
                      key={l}
                      className="rounded-full bg-surface-alt px-2.5 py-1 text-xs capitalize text-brand-teal"
                    >
                      {l}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {traveller.past_destinations.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-brand-teal">
                  Been to
                </h3>
                <div className="flex flex-wrap gap-2">
                  {traveller.past_destinations.map((d) => (
                    <Link
                      key={d.id}
                      href={`/discover/${d.slug}`}
                      className="flex items-center gap-1.5 rounded-full border border-line-input py-1 pl-1 pr-3 text-xs text-brand-teal transition hover:border-brand-teal"
                    >
                      <Image
                        src={d.image_url}
                        alt=""
                        width={40}
                        height={40}
                        unoptimized
                        className="h-6 w-6 rounded-full object-cover"
                      />
                      {d.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {blocked ? (
              <p className="rounded-xl bg-surface-alt px-3 py-2 text-xs text-text-subtle">
                You&apos;ve blocked {traveller.display_name}.
              </p>
            ) : (
              <div className="flex justify-end gap-2 border-t border-line pt-3">
                <button
                  type="button"
                  onClick={() => setShowReport(true)}
                  className="rounded-full px-3.5 py-1.5 text-xs font-semibold text-text-subtle hover:text-brand-teal"
                >
                  Report
                </button>
                <button
                  type="button"
                  onClick={handleBlock}
                  disabled={blocking}
                  className="rounded-full px-3.5 py-1.5 text-xs font-semibold text-brand-coral-ink transition hover:bg-brand-coral-tint disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {blocking ? "Blocking…" : "Block"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {showReport && traveller && (
        <ReportUserDialog
          supabaseUserId={supabaseUserId}
          displayName={traveller.display_name}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}
