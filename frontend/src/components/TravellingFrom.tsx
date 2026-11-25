"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api, ApiError } from "@/lib/api";
import { START_CITIES } from "@/lib/discover";
import { placeQuerySchema } from "@/lib/schemas";

/** Where the traveller is starting from — what Discover measures distances to. */
export interface Origin {
  label: string;
  lat: number;
  lng: number;
}

// Two decimals is ~1 km: plenty for "how far is Coorg", and it keeps a
// precise GPS fix out of the URL (which is shareable) and browser storage.
const round = (n: number) => Math.round(n * 100) / 100;

const QUICK_PICKS = ["Bengaluru", "Mumbai", "Delhi", "Chennai", "Hyderabad", "Kolkata", "Pune", "Kochi"];

/** Lucide `map-pin`. */
function Pin({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

/** Lucide `locate-fixed`. */
function Locate({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" x2="5" y1="12" y2="12" />
      <line x1="19" x2="22" y1="12" y2="12" />
      <line x1="12" x2="12" y1="2" y2="5" />
      <line x1="12" x2="12" y1="19" y2="22" />
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/**
 * "Travelling from …" — detect the current location, type a city, or fall
 * back to the profile city. Only a rounded point ever leaves this component.
 */
export function TravellingFrom({
  origin,
  profileOrigin,
  onChange,
}: {
  origin: Origin | null;
  /** The profile's city, offered as the default; null if none is set. */
  profileOrigin: Origin | null;
  /** null = go back to the profile city. */
  onChange: (origin: Origin | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<"locating" | "searching" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setError(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const choose = (next: Origin | null) => {
    onChange(next);
    setQuery("");
    close();
  };

  const detect = () => {
    if (!("geolocation" in navigator)) {
      setError("Your browser can't share its location. Type a city instead.");
      return;
    }
    setBusy("locating");
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(null);
        choose({
          label: "Your current location",
          lat: round(pos.coords.latitude),
          lng: round(pos.coords.longitude),
        });
      },
      (err) => {
        setBusy(null);
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location access is blocked. Allow it in your browser, or type a city."
            : "Couldn't get your location right now. Type a city instead.",
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  };

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const checked = placeQuerySchema.safeParse(query);
    if (!checked.success) {
      setError(checked.error.issues[0].message);
      return;
    }
    const q = checked.data;
    // Known cities resolve instantly, without a lookup.
    const known = Object.keys(START_CITIES).find((c) => c.toLowerCase() === q.toLowerCase());
    if (known) {
      const [lat, lng] = START_CITIES[known];
      choose({ label: known, lat, lng });
      return;
    }
    setBusy("searching");
    setError(null);
    try {
      const place = await api.get<Origin>(`/api/geocode/?q=${encodeURIComponent(q)}`);
      choose(place);
    } catch (err) {
      const detail =
        err instanceof ApiError ? (err.data as { detail?: string } | undefined)?.detail : null;
      setError(detail ?? "Couldn't look that place up. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const usingProfile =
    !!origin && !!profileOrigin && origin.lat === profileOrigin.lat && origin.lng === profileOrigin.lng;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`group flex h-[42px] max-w-full items-center gap-2.5 rounded-full border bg-white pl-1 pr-4 text-left shadow-sm transition hover:border-brand-teal ${
          open ? "border-brand-coral ring-2 ring-brand-coral/30" : "border-line-input"
        }`}
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-coral-tint text-brand-coral-ink">
          <Pin className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-[11px] leading-tight text-text-subtle">Travelling from</span>
          <span className="block truncate text-sm font-semibold leading-tight text-brand-teal">
            {origin ? origin.label : "Set your starting point"}
          </span>
        </span>
        <span className="ml-1 shrink-0 text-xs font-bold text-brand-coral-ink group-hover:underline">
          Change
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Where are you travelling from?"
          className="absolute left-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-line bg-white p-4 shadow-xl shadow-brand-teal/10"
        >
          <p className="font-serif text-lg text-brand-teal">Where are you starting from?</p>
          <p className="mt-0.5 text-xs text-text-subtle">
            We&apos;ll show how far each destination is from here.
          </p>

          <button
            type="button"
            onClick={detect}
            disabled={busy !== null}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-teal px-4 py-2.5 text-sm font-bold text-background transition hover:brightness-90 disabled:opacity-60"
          >
            <Locate className="h-4 w-4" />
            {busy === "locating" ? "Finding you…" : "Use my current location"}
          </button>

          <div className="my-3 flex items-center gap-3 text-[11px] uppercase tracking-wide text-text-subtle">
            <span className="h-px flex-1 bg-line" />
            or type a place
            <span className="h-px flex-1 bg-line" />
          </div>

          <form onSubmit={search} className="flex gap-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. Mysuru, Indore, Shillong"
              maxLength={120}
              aria-label="City or town you're travelling from"
              className="min-w-0 flex-1 rounded-xl border border-line-input bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-coral focus:ring-2 focus:ring-brand-coral/30"
            />
            <button
              type="submit"
              disabled={busy !== null || !query.trim()}
              className="shrink-0 rounded-xl border border-brand-teal px-3.5 py-2 text-sm font-bold text-brand-teal transition hover:bg-brand-teal hover:text-background disabled:opacity-50"
            >
              {busy === "searching" ? "…" : "Set"}
            </button>
          </form>

          {error && (
            <p role="alert" className="mt-2 rounded-lg bg-[#fbeae6] px-3 py-2 text-xs text-[#8c2f1d]">
              {error}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {QUICK_PICKS.map((city) => {
              const [lat, lng] = START_CITIES[city];
              const on = origin?.lat === lat && origin?.lng === lng;
              return (
                <button
                  key={city}
                  type="button"
                  onClick={() => choose({ label: city, lat, lng })}
                  aria-pressed={on}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    on
                      ? "border-brand-teal bg-brand-teal text-background"
                      : "border-line-input text-brand-teal hover:border-brand-teal"
                  }`}
                >
                  {city}
                </button>
              );
            })}
          </div>

          {profileOrigin && !usingProfile && (
            <button
              type="button"
              onClick={() => choose(null)}
              className="mt-3 w-full rounded-xl px-3 py-2 text-left text-xs font-semibold text-text-subtle transition hover:bg-surface-alt hover:text-brand-teal"
            >
              ↺ Back to my profile city ({profileOrigin.label})
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Great-circle distance in km, rounded — for the "x km away" on each card. */
export function distanceKm(a: Origin, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.sqrt(h)));
}
