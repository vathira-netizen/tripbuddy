"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { toast } from "sonner";

import {
  Destination,
  formatINR,
  getDestination,
  listSaved,
  saveDestination,
  TIER_LABELS,
  unsaveDestination,
} from "@/lib/discover";
import { airbnbUrl, bookingComUrl, googleFlightsUrl, makeMyTripFlightsUrl } from "@/lib/booking";
import { FormError } from "@/components/ui";
import DestinationReviews from "@/components/DestinationReviews";
import OpenTripsToJoin from "@/components/OpenTripsToJoin";

/** Lucide `heart`, matching the one already inlined on the /discover list. */
function Heart({ filled, className = "" }: { filled: boolean; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={className}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </svg>
  );
}

/** A fixed, labelled estimate — not curated per-destination data (none exists). */
const BUDGET_SPLIT = [
  { label: "Stay", share: 0.4 },
  { label: "Food", share: 0.25 },
  { label: "Local transport", share: 0.15 },
  { label: "Activities", share: 0.2 },
] as const;

export default function DestinationDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [destination, setDestination] = useState<Destination | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [activePhoto, setActivePhoto] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);
      const [dest, saved] = await Promise.all([
        getDestination(slug),
        listSaved().catch(() => []),
      ]);
      return { dest, saved };
    };

    run()
      .then(({ dest, saved }) => {
        if (cancelled) return;
        setDestination(dest);
        setSavedId(saved.find((s) => s.destination.id === dest.id)?.id ?? null);
      })
      .catch(() => !cancelled && setError("Couldn't load this destination."))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [slug]);

  async function toggleSave() {
    if (!destination) return;
    setSaving(true);
    try {
      if (savedId) {
        await unsaveDestination(savedId);
        setSavedId(null);
      } else {
        const row = await saveDestination(destination.id);
        setSavedId(row.id);
        toast.success("Added to your saved destinations");
      }
    } catch {
      toast.error("Couldn't update your saved list. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <p className="text-sm text-text-subtle">Loading…</p>
      </main>
    );
  }

  if (!destination) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <FormError message={error ?? "Couldn't load this destination."} />
      </main>
    );
  }

  const photos = [destination.image_url, ...destination.image_urls].filter(Boolean);
  const dailyBudget = destination.avg_daily_budget;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-6">
      {/* Hero gallery */}
      <div className="space-y-2">
        <div className="relative h-[320px] w-full overflow-hidden rounded-[20px] border border-line">
          <Image
            src={photos[activePhoto]}
            alt={destination.name}
            width={1000}
            height={640}
            unoptimized
            className="h-full w-full object-cover"
          />
          <span className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-brand-teal shadow-sm backdrop-blur">
            {TIER_LABELS[destination.budget_tier]}
          </span>
          <button
            type="button"
            onClick={toggleSave}
            disabled={saving}
            aria-pressed={!!savedId}
            aria-label={savedId ? `Unsave ${destination.name}` : `Save ${destination.name}`}
            className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white shadow-sm transition hover:scale-110 disabled:cursor-not-allowed"
          >
            <Heart
              filled={!!savedId}
              className={`h-5 w-5 ${savedId ? "text-brand-coral" : "text-[#c2c8c0]"}`}
            />
          </button>
          {photos.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous photo"
                onClick={() => setActivePhoto((i) => (i - 1 + photos.length) % photos.length)}
                className="absolute left-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-brand-teal shadow-sm"
              >
                ‹
              </button>
              <button
                type="button"
                aria-label="Next photo"
                onClick={() => setActivePhoto((i) => (i + 1) % photos.length)}
                className="absolute right-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-brand-teal shadow-sm"
              >
                ›
              </button>
            </>
          )}
        </div>
        {photos.length > 1 && (
          <div className="flex gap-2 overflow-x-auto">
            {photos.map((src, i) => (
              <button
                key={src}
                type="button"
                onClick={() => setActivePhoto(i)}
                aria-label={`Photo ${i + 1}`}
                aria-current={activePhoto === i}
                className={`h-14 w-20 shrink-0 overflow-hidden rounded-lg border-2 transition ${
                  activePhoto === i ? "border-brand-coral" : "border-transparent opacity-70"
                }`}
              >
                <Image src={src} alt="" width={160} height={112} unoptimized className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <h1 className="text-4xl leading-none tracking-tight">{destination.name}</h1>
        <p className="mt-1.5 text-sm text-text-subtle">
          {destination.region}
          {destination.best_season && ` · Best ${destination.best_season}`}
        </p>
      </div>

      {error && <FormError message={error} />}

      {/* Highlights */}
      {destination.interest_tags.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-brand-teal">
            Highlights
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {destination.interest_tags.map((t) => (
              <span
                key={t}
                className="rounded-full bg-surface-alt px-3 py-1 text-xs capitalize text-brand-teal"
              >
                {t}
              </span>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Budget breakdown */}
        <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-brand-teal">
            Recommended daily budget
          </h2>
          <p className="font-serif text-2xl text-brand-coral-ink">
            {formatINR(dailyBudget)}
            <span className="font-sans text-xs text-text-subtle"> / day / person</span>
          </p>
          <ul className="space-y-2">
            {BUDGET_SPLIT.map(({ label, share }) => (
              <li key={label} className="space-y-1">
                <div className="flex items-center justify-between text-xs text-text-subtle">
                  <span>{label}</span>
                  <span className="tabular-nums">{formatINR(Math.round(dailyBudget * share))}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                  <div className="h-full bg-brand-teal" style={{ width: `${share * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-text-subtle">
            An estimated split, not destination-specific pricing data.
          </p>
        </section>

        {/* Weather advisory */}
        <section className="space-y-2 rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-brand-teal">
            Best time to visit
          </h2>
          <p className="text-sm">
            {destination.best_season
              ? `${destination.best_season} is generally the best window for ${destination.name}.`
              : "No specific season recorded for this destination yet."}
          </p>
          <p className="text-xs text-text-subtle">
            Expect higher prices and bigger crowds in peak months, and book stays
            further ahead if travelling then. This is general seasonal guidance,
            not a live weather forecast.
          </p>
        </section>
      </div>

      {/* CTAs */}
      <div className="flex flex-wrap gap-3 rounded-2xl border border-line bg-surface-alt p-4">
        <Link
          href={`/trips?destination=${destination.id}`}
          className="rounded-full bg-brand-teal px-5 py-2.5 text-sm font-bold text-background transition hover:brightness-90"
        >
          Start a Trip Here
        </Link>
        <Link
          href={`/buddies?destination=${destination.id}`}
          className="rounded-full border border-[#c2c8c0] px-5 py-2.5 text-sm font-bold text-brand-teal transition hover:border-brand-teal"
        >
          Find Travel Buddies for {destination.name}
        </Link>
      </div>

      <OpenTripsToJoin destinationId={destination.id} destinationName={destination.name} />

      <DestinationReviews
        destinationId={destination.id}
        avgRating={destination.avg_rating}
        reviewCount={destination.review_count}
      />

      {/* Booking hand-off */}
      <section className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-brand-teal">
          Search flights &amp; stays
        </h2>
        <div className="flex flex-wrap gap-2 text-sm">
          <a
            href={googleFlightsUrl(destination.name)}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-[#d5d9d0] px-4 py-1.5 font-semibold text-brand-teal transition hover:border-brand-teal"
          >
            Google Flights →
          </a>
          <a
            href={makeMyTripFlightsUrl(destination.name)}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-[#d5d9d0] px-4 py-1.5 font-semibold text-brand-teal transition hover:border-brand-teal"
          >
            MakeMyTrip →
          </a>
          <a
            href={bookingComUrl(destination.name)}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-[#d5d9d0] px-4 py-1.5 font-semibold text-brand-teal transition hover:border-brand-teal"
          >
            Booking.com →
          </a>
          <a
            href={airbnbUrl(destination.name)}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-[#d5d9d0] px-4 py-1.5 font-semibold text-brand-teal transition hover:border-brand-teal"
          >
            Airbnb →
          </a>
        </div>
      </section>
    </main>
  );
}
