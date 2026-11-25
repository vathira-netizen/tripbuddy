"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ChangeEvent, ReactNode } from "react";

import { api, ApiError } from "@/lib/api";
import { needsPhoneVerification } from "@/lib/phone";
import { PhonePrompt } from "@/components/PhonePrompt";
import {
  BuddyCandidate,
  DEFAULT_RADIUS_KM,
  listBuddies,
  RADIUS_OPTIONS,
} from "@/lib/buddies";
import { Destination, listDestinations } from "@/lib/discover";
import type { Profile } from "@/lib/schemas";
import { AGE_BANDS, GENDERS } from "@/lib/vocab";
import { BuddyCard } from "@/components/BuddyCard";
import { FriendsList } from "@/components/FriendsList";
import { IncomingRequests } from "@/components/IncomingRequests";
import { FormError, Select } from "@/components/ui";

/** One segment of the radius/age pill control — a native `<select>` styled as a white pill on the `#efece4` track, so every radius/age option stays reachable. */
function PillSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  children: ReactNode;
}) {
  return (
    <label className="relative block">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={onChange}
        className="cursor-pointer appearance-none rounded-full bg-white py-1.5 pl-4 pr-7 text-sm font-bold text-brand-teal shadow-sm outline-none"
      >
        {children}
      </select>
      <span
        aria-hidden
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-text-subtle"
      >
        ▾
      </span>
    </label>
  );
}

function BuddiesInner() {
  const router = useRouter();
  const params = useSearchParams();

  // Filters live in the URL, matching /discover, so a search is shareable and
  // the back button behaves.
  const radiusKm = Number(params.get("radius") ?? DEFAULT_RADIUS_KM);
  const gender = params.get("gender") ?? "";
  const ageBand = params.get("age_band") ?? "";
  const destination = params.get("destination") ?? "";
  const womenOnly = params.get("women_only") === "true";

  const [candidates, setCandidates] = useState<BuddyCandidate[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [myProfile, setMyProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsArea, setNeedsArea] = useState(false);
  const [needsPhone, setNeedsPhone] = useState(false);
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

  // Decides whether the "Women-only matches" toggle is even shown — eligibility
  // mirrors the backend's own check (apps.matching.views.BuddyViewSet.list).
  useEffect(() => {
    api
      .get<Profile>("/api/profile/me/")
      .then(setMyProfile)
      .catch(() => {});
  }, []);
  const eligibleForWomenOnly = myProfile?.gender === "female" && myProfile?.email_verified;

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);
      setNeedsArea(false);
      setNeedsPhone(false);
      try {
        const page = await listBuddies({
          radiusKm,
          gender: gender || undefined,
          ageBand: ageBand || undefined,
          destination: destination ? Number(destination) : undefined,
          womenOnly: womenOnly || undefined,
        });
        if (!cancelled) setCandidates(page.results);
      } catch (err) {
        if (cancelled) return;
        setCandidates([]);
        if (needsPhoneVerification(err)) {
          setNeedsPhone(true);
        } else if (err instanceof ApiError && err.status === 409) {
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
  }, [radiusKm, gender, ageBand, destination, womenOnly, refreshKey]);

  const sortedDestinations = useMemo(
    () => [...destinations].sort((a, b) => a.name.localeCompare(b.name)),
    [destinations],
  );

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 p-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl leading-none tracking-tight">Your buddies</h1>
          <p className="mt-1.5 text-sm text-text-subtle">
            Ranked by how well your interests, budget, languages, age and saved
            destinations line up — and how close you are. Locations are always
            approximate.
          </p>
        </div>
        <div className="inline-flex gap-1 rounded-full bg-[#efece4] p-1">
          <PillSelect
            label="Radius"
            value={String(radiusKm)}
            onChange={(e) => setParam({ radius: e.target.value })}
          >
            {RADIUS_OPTIONS.map((km) => (
              <option key={km} value={km}>
                {km} km
              </option>
            ))}
          </PillSelect>
          <PillSelect
            label="Age band"
            value={ageBand}
            onChange={(e) => setParam({ age_band: e.target.value })}
          >
            <option value="">All ages</option>
            {AGE_BANDS.map((band) => (
              <option key={band} value={band}>
                {band}
              </option>
            ))}
          </PillSelect>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="order-2 lg:order-1">
          <section
            aria-label="More filters"
            className="mb-5 grid gap-3 rounded-[18px] border border-line bg-surface p-4 sm:grid-cols-2"
          >
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

            {eligibleForWomenOnly && (
              <label className="flex items-center gap-2 text-sm text-brand-teal sm:col-span-2">
                <input
                  type="checkbox"
                  checked={womenOnly}
                  onChange={(e) =>
                    setParam({ women_only: e.target.checked ? "true" : null })
                  }
                />
                Women-only matches
              </label>
            )}
          </section>

          {needsPhone && <PhonePrompt />}

          {needsArea && (
            <p className="rounded-xl bg-brand-coral-tint px-4 py-3 text-sm text-brand-coral-ink">
              Add your city in{" "}
              <Link href="/profile" className="font-semibold underline">
                your profile
              </Link>{" "}
              to find travellers near you.
            </p>
          )}

          {error && <FormError message={error} />}

          {loading && (
            <p aria-busy="true" className="text-sm text-text-subtle">
              Finding travellers…
            </p>
          )}

          {!loading && !error && !needsArea && !needsPhone && candidates.length === 0 && (
            <div className="rounded-xl border border-dashed border-line-input p-8 text-center">
              <p className="font-medium text-brand-teal">No travellers match yet.</p>
              <p className="mt-1 text-sm text-text-subtle">
                Try a wider radius or fewer filters.
              </p>
            </div>
          )}

          {!loading && candidates.length > 0 && (
            <>
              <p className="mb-3 text-sm text-text-subtle">
                {candidates.length} traveller{candidates.length === 1 ? "" : "s"}{" "}
                within {radiusKm} km
              </p>
              <ul className="grid gap-[18px] sm:grid-cols-2 xl:grid-cols-3">
                {candidates.map((candidate, i) => (
                  <li key={candidate.supabase_user_id} className="flex">
                    <div className="flex w-full flex-col">
                      <BuddyCard candidate={candidate} index={i} />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <aside className="order-1 space-y-4 lg:order-2">
          <IncomingRequests onAnswered={() => setRefreshKey((k) => k + 1)} />
          <FriendsList />
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
