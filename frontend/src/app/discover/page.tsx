"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { api } from "@/lib/api";
import {
  Destination,
  formatINR,
  listDestinations,
  listSaved,
  nearbyDestinations,
  REGIONS,
  saveDestination,
  TIER_LABELS,
  unsaveDestination,
} from "@/lib/discover";
import { INTEREST_TAGS } from "@/lib/vocab";
import { Select, TagPicker } from "@/components/ui";
import WelcomeWalkthrough from "@/components/WelcomeWalkthrough";

// Leaflet touches window on import, so the map is client-only.
const DestinationMap = dynamic(() => import("@/components/DestinationMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-black/5" />,
});

const BUDGET_MIN = 500;
const BUDGET_MAX = 5000;

/** Lucide `heart`, inlined — two glyphs do not justify a dependency. */
export function Heart({ filled, className = "" }: { filled: boolean; className?: string }) {
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

function DiscoverInner() {
  const router = useRouter();
  const params = useSearchParams();

  // Filters live in the URL so results are shareable/bookmarkable.
  const minBudget = Number(params.get("min") ?? BUDGET_MIN);
  const maxBudget = Number(params.get("max") ?? BUDGET_MAX);
  const region = params.get("region") ?? "";
  const interests = useMemo(
    () => (params.get("interests")?.split(",").filter(Boolean) ?? []),
    [params],
  );
  const sort = params.get("sort") ?? "budget"; // "budget" | "proximity"
  const [showWelcome, setShowWelcome] = useState(params.get("welcome") === "1");

  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [savedByDest, setSavedByDest] = useState<Record<number, number>>({});
  const [selected, setSelected] = useState<Destination | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const setParam = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      router.replace(`/discover?${next.toString()}`, { scroll: false });
    },
    [params, router],
  );

  // Load the saved list once so cards can show their save state.
  useEffect(() => {
    listSaved()
      .then((rows) =>
        setSavedByDest(Object.fromEntries(rows.map((r) => [r.destination.id, r.id]))),
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);
      if (sort === "proximity") {
        const me = await api.get<{ area: { lat: number; lng: number } | null }>(
          "/api/profile/me/",
        );
        if (!me.area) {
          throw new Error(
            "Add your city in your profile to sort by distance.",
          );
        }
        return nearbyDestinations(me.area.lat, me.area.lng);
      }
      return listDestinations({
        minBudget,
        maxBudget,
        region: region || undefined,
        interests,
        ordering: "avg_daily_budget",
      });
    };

    run()
      .then((rows) => {
        if (cancelled) return;
        // Proximity results come pre-filtered by the API; still apply the
        // budget/region/interest facets client-side so the panel stays live.
        const filtered =
          sort === "proximity"
            ? rows.filter(
                (d) =>
                  d.avg_daily_budget >= minBudget &&
                  d.avg_daily_budget <= maxBudget &&
                  (!region || d.region.toLowerCase() === region.toLowerCase()) &&
                  (interests.length === 0 ||
                    interests.some((t) => d.interest_tags.includes(t))),
              )
            : rows;
        setDestinations(filtered);
      })
      .catch((e) => !cancelled && setError(e.message ?? "Failed to load destinations."))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [minBudget, maxBudget, region, interests, sort]);

  async function toggleSave(d: Destination) {
    const existing = savedByDest[d.id];
    // Optimistic: flip immediately, roll back on failure.
    setSavedByDest((prev) => {
      const next = { ...prev };
      if (existing) delete next[d.id];
      else next[d.id] = -1;
      return next;
    });
    try {
      if (existing) {
        await unsaveDestination(existing);
      } else {
        const row = await saveDestination(d.id);
        setSavedByDest((prev) => ({ ...prev, [d.id]: row.id }));
        toast.success("Added to your saved destinations");
      }
    } catch {
      // Roll back to the pre-click state and let the user know it didn't stick.
      setSavedByDest((prev) => {
        const next = { ...prev };
        if (existing) next[d.id] = existing;
        else delete next[d.id];
        return next;
      });
      toast.error(
        existing
          ? `Couldn't remove ${d.name} from Saved. Try again.`
          : `Couldn't save ${d.name}. Try again.`,
      );
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-7">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl leading-none tracking-tight">Discover</h1>
          <p className="mt-1.5 text-sm text-text-subtle">
            {loading
              ? "Loading destinations…"
              : `${destinations.length} destination${
                  destinations.length === 1 ? "" : "s"
                } within your budget`}
          </p>
        </div>
        <Link
          href="/discover/saved"
          className="inline-flex items-center gap-1.5 text-sm font-bold text-brand-coral-ink"
        >
          <Heart filled className="h-4 w-4" />
          Saved
        </Link>
      </div>

      {/* Filter bar — one surface card across the top (ref 6a). */}
      <div className="mb-5 rounded-[18px] border border-line bg-surface p-4">
        <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
          <fieldset className="min-w-[190px]">
            <legend className="text-xs text-text-subtle">Budget</legend>
            <p className="text-sm text-text-muted">
              <span className="font-bold tabular-nums text-brand-teal">
                {formatINR(minBudget)}–{formatINR(maxBudget)}
              </span>
              /day
            </p>
            <input
              type="range"
              min={BUDGET_MIN}
              max={BUDGET_MAX}
              step={100}
              value={minBudget}
              aria-label="Minimum daily budget"
              onChange={(e) =>
                setParam({ min: String(Math.min(Number(e.target.value), maxBudget)) })
              }
              className="mt-1.5 w-full accent-brand-teal"
            />
            <input
              type="range"
              min={BUDGET_MIN}
              max={BUDGET_MAX}
              step={100}
              value={maxBudget}
              aria-label="Maximum daily budget"
              onChange={(e) =>
                setParam({ max: String(Math.max(Number(e.target.value), minBudget)) })
              }
              className="w-full accent-brand-teal"
            />
          </fieldset>

          <div className="hidden h-10 w-px self-center bg-line sm:block" />

          <div className="min-w-[150px]">
            <Select
              label="Region"
              value={region}
              onChange={(e) => setParam({ region: e.target.value })}
            >
              <option value="">All regions</option>
              {REGIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </div>

          <TagPicker
            legend="Interests"
            options={INTEREST_TAGS}
            selected={interests}
            onToggle={(tag) => {
              const next = interests.includes(tag)
                ? interests.filter((t) => t !== tag)
                : [...interests, tag];
              setParam({ interests: next.join(",") });
            }}
          />

          {/* Segmented control: the active option is a white pill on a warm track. */}
          <fieldset className="ml-auto">
            <legend className="text-xs text-text-subtle">Sort by</legend>
            <div
              role="radiogroup"
              aria-label="Sort by"
              className="mt-1 inline-flex rounded-full bg-[#efece4] p-0.5"
            >
              {(["budget", "proximity"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={sort === option}
                  onClick={() => setParam({ sort: option })}
                  className={`rounded-full px-4 py-1.5 text-sm transition ${
                    sort === option
                      ? "bg-white font-bold text-brand-teal shadow-sm"
                      : "text-text-subtle hover:text-brand-teal"
                  }`}
                >
                  {option === "budget" ? "Budget" : "Nearby"}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      </div>

      <div className="h-64 overflow-hidden rounded-[20px] border border-line">
        <DestinationMap
          destinations={destinations}
          selected={selected}
          onSelect={setSelected}
        />
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl bg-[#fbeae6] px-3 py-2 text-sm text-[#8c2f1d]"
        >
          {error}
        </p>
      )}

      <ul className="mt-5 grid gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
        {destinations.map((d) => {
          const isSaved = d.id in savedByDest;
          const isSelected = selected?.id === d.id;
          const shownTags = d.interest_tags.slice(0, 3);
          const extraTags = d.interest_tags.length - shownTags.length;
          return (
            <li
              key={d.id}
              onMouseEnter={() => setSelected(d)}
              className={`group relative overflow-hidden rounded-[18px] border bg-surface transition hover:-translate-y-0.5 hover:shadow-lg ${
                isSelected ? "border-brand-coral ring-1 ring-brand-coral" : "border-line"
              }`}
            >
              {/* Stretched link: the whole card navigates to the detail page.
                  The save button sits above it (relative z-10) so it keeps
                  its own click instead of triggering the navigation. */}
              <Link
                href={`/discover/${d.slug}`}
                className="absolute inset-0 z-0"
                aria-label={`View ${d.name}`}
              />

              <div className="relative h-[160px] w-full overflow-hidden">
                <Image
                  src={d.image_url}
                  alt={d.name}
                  width={600}
                  height={400}
                  unoptimized
                  className="h-[160px] w-full object-cover transition duration-300 group-hover:scale-105"
                />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/55 to-transparent" />
                <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-0.5 text-xs font-semibold text-brand-teal shadow-sm backdrop-blur">
                  {TIER_LABELS[d.budget_tier]}
                </span>
                {d.avg_rating != null && (
                  <span className="absolute bottom-2.5 left-3 inline-flex items-center gap-1 text-xs font-semibold text-white drop-shadow">
                    <svg
                      aria-hidden
                      viewBox="0 0 24 24"
                      className="h-3.5 w-3.5"
                      fill="currentColor"
                    >
                      <path d="M12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9 12 2Z" />
                    </svg>
                    {d.avg_rating.toFixed(1)}
                    <span className="font-normal text-white/80">({d.review_count})</span>
                  </span>
                )}
                {isSaved && (
                  <span className="absolute bottom-2.5 right-3 inline-flex items-center gap-1 rounded-full bg-brand-coral px-2.5 py-0.5 text-[11px] font-semibold text-white shadow-sm">
                    <svg
                      aria-hidden
                      viewBox="0 0 24 24"
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                    Saved
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  toggleSave(d);
                }}
                aria-pressed={isSaved}
                aria-label={isSaved ? `Unsave ${d.name}` : `Save ${d.name}`}
                className="absolute right-3 top-3 z-10 grid h-[34px] w-[34px] place-items-center rounded-full bg-white shadow-sm transition hover:scale-110"
              >
                <Heart
                  filled={isSaved}
                  className={`h-4 w-4 ${isSaved ? "text-brand-coral" : "text-[#c2c8c0]"}`}
                />
              </button>

              <div className="pointer-events-none relative px-4 pb-4 pt-3.5">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-[22px] leading-tight transition-colors group-hover:text-brand-coral-ink">
                    {d.name}
                  </h2>
                  <span className="whitespace-nowrap font-serif text-[19px] text-brand-coral-ink">
                    {formatINR(d.avg_daily_budget)}
                    <span className="font-sans text-[11px] text-text-subtle">/day</span>
                  </span>
                </div>
                <p className="mb-2.5 mt-1 text-xs text-text-subtle">
                  {d.region}
                  {d.distance_km != null && ` · ${d.distance_km} km away`}
                  {d.best_season && ` · Best ${d.best_season}`}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {shownTags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-surface-alt px-2.5 py-0.5 text-[11px] capitalize text-brand-teal"
                    >
                      {t}
                    </span>
                  ))}
                  {extraTags > 0 && (
                    <span className="text-[11px] text-text-subtle">+{extraTags} more</span>
                  )}
                  <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-brand-teal opacity-0 transition-opacity group-hover:opacity-100">
                    Explore
                    <svg
                      aria-hidden
                      viewBox="0 0 24 24"
                      className="h-3 w-3 transition-transform group-hover:translate-x-0.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {showWelcome && (
        <WelcomeWalkthrough
          onDismiss={() => {
            setShowWelcome(false);
            setParam({ welcome: null });
          }}
        />
      )}
    </main>
  );
}

export default function DiscoverPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm">Loading…</p>}>
      <DiscoverInner />
    </Suspense>
  );
}
