"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { api } from "@/lib/api";
import { Destination } from "@/lib/discover";
import { createTrip, listTrips, openTripToJoin, Trip } from "@/lib/trips";
import { FormError, Input, Select } from "@/components/ui";

/** Lucide `arrow-right`, inlined — matches the `heart`/`map-pin` icons already inlined elsewhere. */
function ArrowRight({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function TripsInner() {
  const params = useSearchParams();
  // A destination detail page's "Start a Trip Here" CTA lands here with the
  // destination pre-picked; applied once the catalogue has loaded (see below).
  const prefillDestination = params.get("destination") ?? "";

  const [trips, setTrips] = useState<Trip[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [openToJoin, setOpenToJoin] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listTrips(),
      api
        .get<{ results: Destination[] }>("/api/destinations/")
        .then((p) => p.results)
        .catch(() => [] as Destination[]),
    ])
      .then(([tripsData, destData]) => {
        if (cancelled) return;
        setTrips(tripsData);
        setDestinations(destData);
        if (prefillDestination) {
          const match = destData.find((d) => String(d.id) === prefillDestination);
          if (match) {
            setDestination(String(match.id));
            setTitle((t) => t || `Trip to ${match.name}`);
          }
        }
      })
      .catch(() => !cancelled && setError("Couldn't load your trips."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prefill only applies once, from the URL at mount
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      let trip = await createTrip({
        title: title.trim(),
        destination: destination ? Number(destination) : null,
        start_date: startDate || null,
        end_date: endDate || null,
      });
      if (openToJoin) {
        trip = await openTripToJoin(trip.id);
      }
      setTrips((prev) => [trip, ...prev]);
      setTitle("");
      setDestination("");
      setStartDate("");
      setEndDate("");
      setOpenToJoin(false);
    } catch {
      setError("Couldn't create the trip. Check the dates and try again.");
    } finally {
      setSaving(false);
    }
  }

  const destById = useMemo(
    () => Object.fromEntries(destinations.map((d) => [d.id, d])),
    [destinations],
  );

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-8 px-4 py-6">
      <h1 className="text-4xl leading-none tracking-tight">Your trips</h1>

      {error && <FormError message={error} />}

      <form
        onSubmit={handleCreate}
        className="space-y-3 rounded-[18px] border border-line bg-surface p-5"
      >
        <h2 className="font-serif text-xl text-brand-teal">Plan a new trip</h2>
        <Input
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Goa long weekend"
          required
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Select
            label="Destination"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          >
            <option value="">Anywhere</option>
            {destinations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Input
            label="Start"
            type="date"
            value={startDate}
            max={endDate || undefined}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <Input
            label="End"
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-brand-teal">
          <input
            type="checkbox"
            checked={openToJoin}
            onChange={(e) => setOpenToJoin(e.target.checked)}
          />
          Open to join — let other travellers ask to join this trip
        </label>
        <button
          type="submit"
          disabled={saving || !title.trim()}
          className="inline-flex items-center justify-center rounded-full bg-brand-coral px-6 py-2.5 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Creating…" : "Create trip"}
        </button>
      </form>

      <section className="space-y-3">
        {loading ? (
          <p className="text-sm text-text-subtle">Loading…</p>
        ) : trips.length === 0 ? (
          <p className="text-sm text-text-subtle">
            No trips yet — plan your first one above.
          </p>
        ) : (
          <ul className="grid gap-[18px] sm:grid-cols-2">
            {trips.map((trip) => {
              const photo = trip.destination ? destById[trip.destination] : null;
              const cover = trip.cover_image_url || photo?.image_url;
              return (
                <li key={trip.id}>
                  <Link
                    href={`/trips/${trip.id}`}
                    className="group block overflow-hidden rounded-[18px] border border-line bg-surface transition hover:-translate-y-0.5"
                  >
                    <div className="relative h-24">
                      {cover ? (
                        <Image
                          src={cover}
                          alt=""
                          width={400}
                          height={200}
                          unoptimized
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="h-full w-full bg-brand-teal" />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-brand-teal/75 to-transparent" />
                      <h3 className="absolute bottom-3 left-4 font-serif text-xl text-white">
                        {trip.title}
                      </h3>
                    </div>
                    <div className="flex items-center justify-between gap-3 p-4">
                      <div className="space-y-1.5">
                        <span className="inline-flex items-center rounded-full bg-surface-alt px-3 py-1 text-xs font-semibold text-brand-teal">
                          {trip.start_date ?? "Dates TBD"}
                          {trip.end_date ? ` – ${trip.end_date}` : ""}
                        </span>
                        {trip.collaborators.length > 0 && (
                          <p className="text-xs text-text-subtle">
                            {trip.collaborators.length} collaborator
                            {trip.collaborators.length === 1 ? "" : "s"}
                          </p>
                        )}
                      </div>
                      <span
                        aria-hidden
                        className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-brand-teal text-white transition group-hover:brightness-90"
                      >
                        <ArrowRight className="h-4 w-4" />
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

export default function TripsPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm">Loading…</p>}>
      <TripsInner />
    </Suspense>
  );
}
