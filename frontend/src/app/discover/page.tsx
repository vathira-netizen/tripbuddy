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
  listDestinationsPage,
  DISCOVER_PAGE_SIZE,
  listSaved,
  nearbyDestinations,
  REGIONS,
  STATES,
  START_CITIES,
  DISTANCE_LIMITS,
  saveDestination,
  TIER_LABELS,
  unsaveDestination,
} from "@/lib/discover";
import { INTEREST_TAGS } from "@/lib/vocab";
import { Dropdown, MultiSelectDropdown } from "@/components/ui";
import { distanceKm, type Origin, TravellingFrom } from "@/components/TravellingFrom";
import WelcomeWalkthrough from "@/components/WelcomeWalkthrough";

// Leaflet touches window on import, so the map is client-only.
const DestinationMap = dynamic(() => import("@/components/DestinationMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-black/5" />,
});

// Neutral placeholder shown if a destination photo fails to load.
const FALLBACK_IMG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='600' height='400'><rect width='100%' height='100%' fill='#e7e3d8'/><text x='50%' y='50%' fill='#8a8a80' font-family='sans-serif' font-size='28' text-anchor='middle'>Photo unavailable</text></svg>",
  );

const BUDGET_MIN = 500;
// Remembers the chosen starting point between visits (this browser only).
const ORIGIN_KEY = "tb:discover-origin";

function readStoredOrigin(): Origin | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ORIGIN_KEY);
    const o = raw ? (JSON.parse(raw) as Origin) : null;
    return o && Number.isFinite(o.lat) && Number.isFinite(o.lng) ? o : null;
  } catch {
    return null;
  }
}

function storeOrigin(o: Origin | null) {
  try {
    if (o) window.localStorage.setItem(ORIGIN_KEY, JSON.stringify(o));
    else window.localStorage.removeItem(ORIGIN_KEY);
  } catch {
    // Private mode / blocked storage: the URL still carries the choice.
  }
}
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

/**
 * One track, two handles: the min and max daily budget. Two native range
 * inputs share the track (see .dual-range in globals.css), so keyboard and
 * screen-reader support come for free.
 */
function BudgetRange({
  low,
  high,
  onLow,
  onHigh,
}: {
  low: number;
  high: number;
  onLow: (v: number) => void;
  onHigh: (v: number) => void;
}) {
  const pct = (v: number) => (v - BUDGET_MIN) / (BUDGET_MAX - BUDGET_MIN);
  // The thumbs travel 9px in from each end (half their width); match that so
  // the teal span starts and stops under the handles.
  const at = (v: number) => `calc(9px + (100% - 18px) * ${pct(v)})`;
  return (
    <div className="relative h-[42px]">
      <div className="absolute inset-x-[9px] top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-line" />
      <div
        className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-brand-teal"
        style={{ left: at(low), width: `calc((100% - 18px) * ${pct(high) - pct(low)})` }}
      />
      <input
        type="range"
        min={BUDGET_MIN}
        max={BUDGET_MAX}
        step={100}
        value={low}
        aria-label="Minimum daily budget"
        aria-valuetext={formatINR(low)}
        onChange={(e) => onLow(Number(e.target.value))}
        // When both handles meet at the top end, the low one must sit on top
        // or it could never be dragged back down.
        style={{ zIndex: low > BUDGET_MAX - 500 ? 4 : 3 }}
        className="dual-range"
      />
      <input
        type="range"
        min={BUDGET_MIN}
        max={BUDGET_MAX}
        step={100}
        value={high}
        aria-label="Maximum daily budget"
        aria-valuetext={formatINR(high)}
        onChange={(e) => onHigh(Number(e.target.value))}
        className="dual-range z-[3]"
      />
    </div>
  );
}

function DiscoverInner() {
  const router = useRouter();
  const params = useSearchParams();

  // Filters live in the URL so results are shareable/bookmarkable.
  const minBudget = Number(params.get("min") ?? BUDGET_MIN);
  const maxBudget = Number(params.get("max") ?? BUDGET_MAX);
  const region = params.get("region") ?? "";
  const state = params.get("state") ?? "";
  // Starting point: ?from=<label>&flat=&flng= (or a known city name alone);
  // empty falls back to the last one picked here, then the profile city.
  const from = params.get("from") ?? "";
  const fromLat = Number.parseFloat(params.get("flat") ?? "");
  const fromLng = Number.parseFloat(params.get("flng") ?? "");
  const km = Number(params.get("km") ?? 500);
  const interests = useMemo(
    () => (params.get("interests")?.split(",").filter(Boolean) ?? []),
    [params],
  );
  const sort = params.get("sort") ?? "budget"; // "budget" | "proximity"
  const page = Math.max(Number(params.get("page") ?? 1) || 1, 1);
  const [showWelcome, setShowWelcome] = useState(params.get("welcome") === "1");

  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [total, setTotal] = useState(0);
  const [savedByDest, setSavedByDest] = useState<Record<number, number>>({});
  const [selected, setSelected] = useState<Destination | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileOrigin, setProfileOrigin] = useState<Origin | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [storedOrigin, setStoredOrigin] = useState<Origin | null>(readStoredOrigin);

  const origin = useMemo<Origin | null>(() => {
    if (Number.isFinite(fromLat) && Number.isFinite(fromLng)) {
      return { label: from || "Selected place", lat: fromLat, lng: fromLng };
    }
    const city = START_CITIES[from];
    if (city) return { label: from, lat: city[0], lng: city[1] };
    return storedOrigin ?? profileOrigin;
  }, [from, fromLat, fromLng, storedOrigin, profileOrigin]);
  const originLat = origin?.lat;
  const originLng = origin?.lng;

  // The profile city is the default starting point.
  useEffect(() => {
    api
      .get<{ area: { lat: number; lng: number } | null; area_label: string }>("/api/profile/me/")
      .then((me) => {
        if (me.area) {
          setProfileOrigin({
            label: me.area_label.split(",")[0] || "My city",
            lat: me.area.lat,
            lng: me.area.lng,
          });
        }
      })
      .catch(() => {})
      .finally(() => setProfileLoaded(true));
  }, []);

  const setParam = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      // Any filter change starts again from page 1.
      if (!("page" in updates)) next.delete("page");
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
        if (originLat === undefined || originLng === undefined) {
          throw new Error("Set where you're travelling from to see what's nearby.");
        }
        return { results: await nearbyDestinations(originLat, originLng, km), paged: false };
      }
      const pageData = await listDestinationsPage({
        minBudget,
        maxBudget,
        region: region || undefined,
        state: state || undefined,
        interests,
        ordering: "avg_daily_budget",
        page,
      });
      return { results: pageData.results, count: pageData.count, paged: true };
    };

    // Nearby needs a starting point; wait for the profile city before
    // concluding there isn't one.
    if (sort === "proximity" && originLat === undefined && !profileLoaded) {
      return () => {
        cancelled = true;
      };
    }

    run()
      .then((res) => {
        if (cancelled) return;
        const rows = res.results;
        // Proximity results come pre-filtered by the API; still apply the
        // budget/region/interest facets client-side so the panel stays live.
        const filtered =
          sort === "proximity"
            ? rows.filter(
                (d) =>
                  d.avg_daily_budget >= minBudget &&
                  d.avg_daily_budget <= maxBudget &&
                  (!region || d.region.toLowerCase() === region.toLowerCase()) &&
                  (!state || d.state.toLowerCase() === state.toLowerCase()) &&
                  (interests.length === 0 ||
                    interests.some((t) => d.interest_tags.includes(t))),
              )
            : rows;
        // The API pages the budget list; nearby results arrive whole, so
        // they're paged here to keep the grid the same size.
        if (res.paged) {
          setDestinations(filtered);
          setTotal(res.count ?? filtered.length);
        } else {
          setDestinations(filtered.slice((page - 1) * DISCOVER_PAGE_SIZE, page * DISCOVER_PAGE_SIZE));
          setTotal(filtered.length);
        }
      })
      .catch((e) => !cancelled && setError(e.message ?? "Failed to load destinations."))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [minBudget, maxBudget, region, state, interests, sort, originLat, originLng, profileLoaded, km, page]);

  function changeOrigin(next: Origin | null) {
    storeOrigin(next);
    setStoredOrigin(next);
    setParam(
      next
        ? { from: next.label, flat: String(next.lat), flng: String(next.lng) }
        : { from: null, flat: null, flng: null },
    );
  }

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
              : `${total} destination${total === 1 ? "" : "s"} within your budget`}
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

      {/* Filter card: where you're starting from and how results are ordered
          on top, then one even row of filters. Every control is the same
          height so the rows line up. */}
      <div className="mb-5 rounded-[18px] border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
          <TravellingFrom origin={origin} profileOrigin={profileOrigin} onChange={changeOrigin} />

          <div className="flex flex-wrap items-center gap-2.5">
            <span id="sort-label" className="text-xs text-text-subtle">
              Sort by
            </span>
            <div
              role="radiogroup"
              aria-labelledby="sort-label"
              className="inline-flex h-[42px] rounded-full bg-[#efece4] p-1"
            >
              {(["budget", "proximity"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={sort === option}
                  onClick={() => setParam({ sort: option })}
                  className={`rounded-full px-4 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-brand-coral/40 ${
                    sort === option
                      ? "bg-white font-bold text-brand-teal shadow-sm"
                      : "text-text-subtle hover:text-brand-teal"
                  }`}
                >
                  {option === "budget" ? "Lowest budget" : "Nearest"}
                </button>
              ))}
            </div>
            {sort === "proximity" && (
              <Dropdown
                hideLabel
                align="right"
                className="w-[170px]"
                label="Within"
                value={String(km)}
                onChange={(v) => setParam({ km: v })}
                options={DISTANCE_LIMITS.map((d) => ({ value: String(d), label: `Within ${d} km` }))}
              />
            )}
          </div>
        </div>

        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span id="budget-label" className="text-text-subtle">
                Budget per day
              </span>
              <span className="font-bold tabular-nums text-brand-teal">
                {formatINR(minBudget)} – {formatINR(maxBudget)}
              </span>
            </div>
            <BudgetRange
              low={minBudget}
              high={maxBudget}
              onLow={(v) => setParam({ min: String(Math.min(v, maxBudget)) })}
              onHigh={(v) => setParam({ max: String(Math.max(v, minBudget)) })}
            />
          </div>

          <Dropdown
            label="Region"
            value={region}
            onChange={(v) => setParam({ region: v })}
            options={[
              { value: "", label: "All regions" },
              ...REGIONS.map((r) => ({ value: r, label: r })),
            ]}
          />

          <Dropdown
            label="State"
            value={state}
            onChange={(v) => setParam({ state: v })}
            options={[
              { value: "", label: "All states" },
              ...STATES.map((s) => ({ value: s, label: s })),
            ]}
          />

          <MultiSelectDropdown
            label="Interests"
            options={INTEREST_TAGS}
            selected={interests}
            onToggle={(tag) => {
              const next = interests.includes(tag)
                ? interests.filter((t) => t !== tag)
                : [...interests, tag];
              setParam({ interests: next.join(",") });
            }}
            onClear={() => setParam({ interests: null })}
            emptyLabel="Any interest"
          />
        </div>
      </div>

      {/* List on the left, map pinned on the right so it stays in view while
          the list scrolls (stacked, map first, on narrow screens). */}
      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
      <aside
        aria-label="Map of these destinations"
        className="relative z-0 h-64 overflow-hidden rounded-[20px] border border-line lg:sticky lg:top-24 lg:order-2 lg:h-[calc(100vh-8rem)] lg:self-start"
      >
        <DestinationMap
          destinations={destinations}
          selected={selected}
          onSelect={(d) => {
            setSelected(d);
            document.getElementById(`dest-${d.id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }}
        />
      </aside>

      <div className="min-w-0 lg:order-1">
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl bg-[#fbeae6] px-3 py-2 text-sm text-[#8c2f1d]"
        >
          {error}
        </p>
      )}

      <ul className="grid gap-[18px] sm:grid-cols-2">
        {destinations.map((d) => {
          const isSaved = d.id in savedByDest;
          const isSelected = selected?.id === d.id;
          const shownTags = d.interest_tags.slice(0, 3);
          const extraTags = d.interest_tags.length - shownTags.length;
          return (
            <li
              key={d.id}
              id={`dest-${d.id}`}
              onMouseEnter={() => setSelected(d)}
              onFocus={() => setSelected(d)}
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
                  src={d.image_url || FALLBACK_IMG}
                  onError={(e) => {
                    const img = e.currentTarget;
                    if (!img.src.endsWith(FALLBACK_IMG)) img.src = FALLBACK_IMG;
                  }}
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
                  {origin
                    ? ` · ${distanceKm(origin, d).toLocaleString("en-IN")} km away`
                    : d.distance_km != null && ` · ${d.distance_km} km away`}
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

      {total > DISCOVER_PAGE_SIZE && (
        <nav aria-label="Destination pages" className="mt-8 flex items-center justify-center gap-3">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => {
              setParam({ page: page - 1 > 1 ? String(page - 1) : null });
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-brand-teal disabled:opacity-40"
          >
            ← Previous
          </button>
          <span className="text-sm text-text-subtle" aria-current="page">
            Page {page} of {Math.ceil(total / DISCOVER_PAGE_SIZE)}
          </span>
          <button
            type="button"
            disabled={page >= Math.ceil(total / DISCOVER_PAGE_SIZE) || loading}
            onClick={() => {
              setParam({ page: String(page + 1) });
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-brand-teal disabled:opacity-40"
          >
            Next →
          </button>
        </nav>
      )}
      </div>
      </div>

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
