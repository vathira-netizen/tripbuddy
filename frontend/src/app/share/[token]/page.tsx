"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { SharedTrip, dayLabels, getSharedTrip } from "@/lib/trips";

export default function SharedTripPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [trip, setTrip] = useState<SharedTrip | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "gone">("loading");

  useEffect(() => {
    let cancelled = false;
    getSharedTrip(token)
      .then((data) => {
        if (cancelled) return;
        setTrip(data);
        setStatus("ok");
      })
      .catch(() => !cancelled && setStatus("gone"));
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (status === "loading") {
    return (
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
        <p className="text-sm text-black/60 dark:text-white/60">Loading…</p>
      </main>
    );
  }

  if (status === "gone" || !trip) {
    return (
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-16 text-center">
        <h1 className="text-xl font-bold">This itinerary isn’t available</h1>
        <p className="mt-2 text-sm text-black/60 dark:text-white/60">
          The link may have been turned off by its owner.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
        >
          Plan your own trip
        </Link>
      </main>
    );
  }

  const labels = dayLabels(trip.start_date, trip.nights);
  const columns = labels.map((_, day) =>
    trip.itinerary_items
      .filter((it) => Math.min(Math.max(it.day_index, 0), labels.length - 1) === day)
      .sort((a, b) => a.position - b.position),
  );

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-black/10 pb-4 dark:border-white/10">
        <div>
          <p className="text-xs uppercase tracking-wide text-black/60 dark:text-white/60">
            Shared itinerary
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight">{trip.title}</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            {trip.owner_name && `by ${trip.owner_name} · `}
            {trip.start_date ?? "Dates TBD"}
            {trip.end_date ? ` – ${trip.end_date}` : ""}
          </p>
        </div>
        <Link
          href="/"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
        >
          Plan your own trip
        </Link>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {columns.map((col, day) => (
          <section
            key={day}
            className="flex flex-col gap-2 rounded-xl border border-black/10 p-3 dark:border-white/10"
          >
            <h2 className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
              {labels[day]}
            </h2>
            {col.length === 0 ? (
              <p className="text-xs text-black/40 dark:text-white/40">Nothing planned.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {col.map((item, i) => (
                  <li
                    key={i}
                    className="rounded-lg border border-black/10 bg-white p-2 text-sm shadow-sm dark:border-white/10 dark:bg-white/5"
                  >
                    <p className="font-medium">{item.title}</p>
                    {item.notes && (
                      <p className="whitespace-pre-wrap text-xs text-black/60 dark:text-white/60">
                        {item.notes}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
