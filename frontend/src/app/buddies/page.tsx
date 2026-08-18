"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { ApiError } from "@/lib/api";
import {
  BuddyCandidate,
  DEFAULT_RADIUS_KM,
  listBuddies,
  RADIUS_OPTIONS,
} from "@/lib/buddies";
import { Destination, listDestinations } from "@/lib/discover";
import { AGE_BANDS, GENDERS } from "@/lib/vocab";
import { BuddyCard } from "@/components/BuddyCard";
import { IncomingRequests } from "@/components/IncomingRequests";
import { Select } from "@/components/ui";

function BuddiesInner() {
  const router = useRouter();
  const params = useSearchParams();

  // Filters live in the URL, matching /discover, so a search is shareable and
  // the back button behaves.
  const radiusKm = Number(params.get("radius") ?? DEFAULT_RADIUS_KM);
  const gender = params.get("gender") ?? "";
  const ageBand = params.get("age_band") ?? "";
  const destination = params.get("destination") ?? "";

  const [candidates, setCandidates] = useState<BuddyCandidate[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [needsArea, setNeedsArea] = useState(false);
  const [loading, setLoading] = useState(true);
  // Bumped after a request is answered so the candidate list refetches — an
  // accepted traveller is no longer a candidate.
  const [refreshKey, setRefreshKey] = useState(0);

  const setParam = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      router.replace(`/buddies?${next.toString()}`, { scroll: false });
    },
    [params, router],
  );

  // The destination filter needs the catalogue for its labels.
  useEffect(() => {
    listDestinations({})
      .then(setDestinations)
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);
      setNeedsArea(false);
      try {
        const page = await listBuddies({
          radiusKm,
          gender: gender || undefined,
          ageBand: ageBand || undefined,
          destination: destination ? Number(destination) : undefined,
        });
        if (!cancelled) setCandidates(page.results);
      } catch (err) {
        if (cancelled) return;
        setCandidates([]);
        if (err instanceof ApiError && err.status === 409) {
          // The user has not set a city, so there is no origin to search from.
          setNeedsArea(true);
        } else {
          setError("Could not load travellers. Try again.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [radiusKm, gender, ageBand, destination, refreshKey]);

  const removeCandidate = useCallback((candidate: BuddyCandidate) => {
    // Once a request is sent they stop being a candidate; drop the card rather
    // than leave a "Request sent" tile occupying the grid on the next search.
    setCandidates((current) =>
      current.filter((c) => c.supabase_user_id !== candidate.supabase_user_id),
    );
  }, []);

  const sortedDestinations = useMemo(
    () => [...destinations].sort((a, b) => a.name.localeCompare(b.name)),
    [destinations],
  );

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 p-6">
      <header className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight">Find travel buddies</h1>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          Ranked by how well your interests, budget, languages, age and saved
          destinations line up — and how close you are. Locations are always
          approximate.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="order-2 lg:order-1">
          <section
            aria-label="Filters"
            className="card mb-5 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            <Select
              label="Within"
              name="radius"
              value={String(radiusKm)}
              onChange={(e) => setParam({ radius: e.target.value })}
            >
              {RADIUS_OPTIONS.map((km) => (
                <option key={km} value={km}>
                  {km} km
                </option>
              ))}
            </Select>

            <Select
              label="Gender"
              name="gender"
              value={gender}
              onChange={(e) => setParam({ gender: e.target.value })}
            >
              <option value="">Anyone</option>
              {GENDERS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </Select>

            <Select
              label="Age band"
              name="age_band"
              value={ageBand}
              onChange={(e) => setParam({ age_band: e.target.value })}
            >
              <option value="">Any age</option>
              {AGE_BANDS.map((band) => (
                <option key={band} value={band}>
                  {band}
                </option>
              ))}
            </Select>

            <Select
              label="Wants to visit"
              name="destination"
              value={destination}
              onChange={(e) => setParam({ destination: e.target.value })}
            >
              <option value="">Anywhere</option>
              {sortedDestinations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </section>

          {needsArea && (
            <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              Add your city in{" "}
              <Link href="/profile" className="font-semibold underline">
                your profile
              </Link>{" "}
              to find travellers near you.
            </p>
          )}

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}

          {loading && (
            <p aria-busy="true" className="text-sm text-black/60 dark:text-white/60">
              Finding travellers…
            </p>
          )}

          {!loading && !error && !needsArea && candidates.length === 0 && (
            <div className="rounded-xl border border-dashed border-black/15 p-8 text-center dark:border-white/20">
              <p className="font-medium">No travellers match yet.</p>
              <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                Try a wider radius or fewer filters.
              </p>
            </div>
          )}

          {!loading && candidates.length > 0 && (
            <>
              <p className="mb-3 text-sm text-black/60 dark:text-white/60">
                {candidates.length} traveller{candidates.length === 1 ? "" : "s"}{" "}
                within {radiusKm} km
              </p>
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {candidates.map((candidate) => (
                  <li key={candidate.supabase_user_id} className="flex">
                    <div className="flex w-full flex-col">
                      <BuddyCard
                        candidate={candidate}
                        onConnected={removeCandidate}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <aside className="order-1 lg:order-2">
          <IncomingRequests onAnswered={() => setRefreshKey((k) => k + 1)} />
        </aside>
      </div>
    </main>
  );
}

export default function BuddiesPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm">Loading…</p>}>
      <BuddiesInner />
    </Suspense>
  );
}
