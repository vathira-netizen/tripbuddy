"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { api } from "@/lib/api";
import { Destination } from "@/lib/discover";
import { createTrip, listTrips, Trip } from "@/lib/trips";

export default function TripsPage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
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
      })
      .catch(() => !cancelled && setError("Couldn't load your trips."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const trip = await createTrip({
        title: title.trim(),
        destination: destination ? Number(destination) : null,
        start_date: startDate || null,
        end_date: endDate || null,
      });
      setTrips((prev) => [trip, ...prev]);
      setTitle("");
      setDestination("");
      setStartDate("");
      setEndDate("");
    } catch {
      setError("Couldn't create the trip. Check the dates and try again.");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25";

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-8 px-4 py-6">
      <h1 className="text-3xl font-extrabold tracking-tight">Your trips</h1>

      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <form onSubmit={handleCreate} className="card space-y-3 p-5">
        <h2 className="text-base font-bold">Plan a new trip</h2>
        <div>
          <label htmlFor="title" className="mb-1 block text-xs text-black/60 dark:text-white/60">
            Title
          </label>
          <input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Goa long weekend"
            required
            className={inputClass}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="destination" className="mb-1 block text-xs text-black/60 dark:text-white/60">
              Destination
            </label>
            <select
              id="destination"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className={inputClass}
            >
              <option value="">Anywhere</option>
              {destinations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="start" className="mb-1 block text-xs text-black/60 dark:text-white/60">
              Start
            </label>
            <input
              id="start"
              type="date"
              value={startDate}
              max={endDate || undefined}
              onChange={(e) => setStartDate(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="end" className="mb-1 block text-xs text-black/60 dark:text-white/60">
              End
            </label>
            <input
              id="end"
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={saving || !title.trim()}
          className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-indigo-600 to-indigo-500 px-6 py-2.5 text-sm font-bold text-white shadow-md shadow-indigo-600/25 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Creating…" : "Create trip"}
        </button>
      </form>

      <section className="space-y-3">
        {loading ? (
          <p className="text-sm text-black/60 dark:text-white/60">Loading…</p>
        ) : trips.length === 0 ? (
          <p className="text-sm text-black/60 dark:text-white/60">
            No trips yet — plan your first one above.
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {trips.map((trip) => (
              <li key={trip.id}>
                <Link
                  href={`/trips/${trip.id}`}
                  className="card group block overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lg"
                >
                  {/* Gradient banner stands in for a trip photo. */}
                  <div className="brand-gradient relative flex h-24 items-end p-4">
                    <span aria-hidden className="absolute right-3 top-2 text-3xl opacity-40">
                      🏝️
                    </span>
                    <h3 className="text-lg font-bold text-white drop-shadow">{trip.title}</h3>
                  </div>
                  <div className="flex items-center justify-between gap-3 p-4">
                    <div className="space-y-1.5">
                      <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
                        📅 {trip.start_date ?? "Dates TBD"}
                        {trip.end_date ? ` – ${trip.end_date}` : ""}
                      </span>
                      {trip.collaborators.length > 0 && (
                        <p className="text-xs text-black/60">
                          👥 {trip.collaborators.length} collaborator
                          {trip.collaborators.length === 1 ? "" : "s"}
                        </p>
                      )}
                    </div>
                    <span
                      aria-hidden
                      className="grid h-8 w-8 place-items-center rounded-full bg-indigo-50 text-indigo-700 transition group-hover:bg-indigo-600 group-hover:text-white"
                    >
                      →
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
