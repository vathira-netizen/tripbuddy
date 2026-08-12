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
    "w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20";

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-8 px-4 py-6">
      <h1 className="text-2xl font-bold tracking-tight">Your trips</h1>

      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <form
        onSubmit={handleCreate}
        className="space-y-3 rounded-xl border border-black/10 p-4 dark:border-white/10"
      >
        <h2 className="text-sm font-semibold">Plan a new trip</h2>
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
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
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
          <ul className="space-y-2">
            {trips.map((trip) => (
              <li key={trip.id}>
                <Link
                  href={`/trips/${trip.id}`}
                  className="flex items-center justify-between gap-4 rounded-xl border border-black/10 px-4 py-3 transition hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
                >
                  <div>
                    <p className="font-medium">{trip.title}</p>
                    <p className="text-xs text-black/60 dark:text-white/60">
                      {trip.start_date ?? "Dates TBD"}
                      {trip.end_date ? ` – ${trip.end_date}` : ""}
                      {trip.collaborators.length > 0 &&
                        ` · ${trip.collaborators.length} collaborator${
                          trip.collaborators.length === 1 ? "" : "s"
                        }`}
                    </p>
                  </div>
                  <span aria-hidden className="text-black/40 dark:text-white/40">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
