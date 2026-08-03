"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";

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

// Leaflet touches window on import, so the map is client-only.
const DestinationMap = dynamic(() => import("@/components/DestinationMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-black/5 dark:bg-white/5" />,
});

const BUDGET_MIN = 500;
const BUDGET_MAX = 5000;

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
      }
    } catch {
      setSavedByDest((prev) => ({ ...prev, [d.id]: existing ?? -1 }));
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Discover</h1>
        <Link href="/discover/saved" className="text-sm font-medium text-indigo-600">
          Saved ♥
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        {/* Filter panel */}
        <aside className="space-y-5">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Daily budget (₹)</legend>
            <label className="flex items-center justify-between text-sm">
              <span>Min</span>
              <span className="tabular-nums">{formatINR(minBudget)}</span>
            </label>
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
              className="w-full"
            />
            <label className="flex items-center justify-between text-sm">
              <span>Max</span>
              <span className="tabular-nums">{formatINR(maxBudget)}</span>
            </label>
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
              className="w-full"
            />
          </fieldset>

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

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Sort by</legend>
            <div className="flex gap-2" role="radiogroup" aria-label="Sort by">
              {(["budget", "proximity"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={sort === option}
                  onClick={() => setParam({ sort: option })}
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-sm capitalize transition ${
                    sort === option
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-black/15 hover:border-indigo-400 dark:border-white/20"
                  }`}
                >
                  {option === "budget" ? "Budget" : "Nearby"}
                </button>
              ))}
            </div>
          </fieldset>
        </aside>

        {/* Results + map */}
        <section className="space-y-4">
          <div className="h-72 overflow-hidden rounded-xl border border-black/10 dark:border-white/10">
            <DestinationMap
              destinations={destinations}
              selected={selected}
              onSelect={setSelected}
            />
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}
          {loading ? (
            <p className="text-sm text-black/60 dark:text-white/60">Loading…</p>
          ) : (
            <p className="text-sm text-black/60 dark:text-white/60">
              {destinations.length} destination{destinations.length === 1 ? "" : "s"}
            </p>
          )}

          <ul className="grid gap-4 sm:grid-cols-2">
            {destinations.map((d) => {
              const isSaved = d.id in savedByDest;
              const isSelected = selected?.id === d.id;
              return (
                <li
                  key={d.id}
                  className={`overflow-hidden rounded-xl border transition ${
                    isSelected
                      ? "border-indigo-500 ring-2 ring-indigo-500/30"
                      : "border-black/10 dark:border-white/10"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelected(d)}
                    className="block w-full text-left"
                    aria-label={`Focus ${d.name} on the map`}
                  >
                    <Image
                      src={d.image_url}
                      alt={d.name}
                      width={600}
                      height={400}
                      unoptimized
                      className="h-36 w-full object-cover"
                    />
                    <div className="space-y-2 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="font-semibold">{d.name}</h2>
                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                          {TIER_LABELS[d.budget_tier]}
                        </span>
                      </div>
                      <p className="text-sm text-black/70 dark:text-white/70">
                        {formatINR(d.avg_daily_budget)}/day
                        {d.distance_km != null && ` · ${d.distance_km} km away`}
                      </p>
                      {d.best_season && (
                        <p className="text-xs text-black/50 dark:text-white/50">
                          Best: {d.best_season}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-1">
                        {d.interest_tags.map((t) => (
                          <span
                            key={t}
                            className="rounded-full bg-black/5 px-2 py-0.5 text-xs capitalize dark:bg-white/10"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>
                  <div className="border-t border-black/10 p-2 dark:border-white/10">
                    <button
                      type="button"
                      onClick={() => toggleSave(d)}
                      aria-pressed={isSaved}
                      className={`w-full rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                        isSaved
                          ? "bg-indigo-600 text-white hover:bg-indigo-500"
                          : "border border-black/15 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                      }`}
                    >
                      {isSaved ? "Saved ♥" : "Save"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
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
