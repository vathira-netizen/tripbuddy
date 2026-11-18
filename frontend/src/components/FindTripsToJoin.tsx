"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Avatar } from "@/components/Avatar";
import { listJoinRequests, OpenTrip, requestToJoinTrip, searchOpenTrips } from "@/lib/trips";

/** Search other travellers' open-to-join trips and ask to join one. */
export default function FindTripsToJoin() {
  const [query, setQuery] = useState("");
  const [trips, setTrips] = useState<OpenTrip[]>([]);
  const [requested, setRequested] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // Which trips you've already asked to join, so their button says so.
  useEffect(() => {
    listJoinRequests()
      .then((rows) =>
        setRequested(new Set(rows.filter((r) => r.status === "pending").map((r) => r.trip))),
      )
      .catch(() => {});
  }, []);

  // Debounced so typing doesn't fire a request per keystroke.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      searchOpenTrips(query.trim())
        .then((rows) => !cancelled && setTrips(rows))
        .catch(() => !cancelled && setTrips([]))
        .finally(() => !cancelled && setLoading(false));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  async function askToJoin(trip: OpenTrip) {
    setSending(trip.id);
    try {
      await requestToJoinTrip(trip.id);
      setRequested((prev) => new Set(prev).add(trip.id));
      toast.success(`Request sent to ${trip.owner_name}`);
    } catch {
      toast.error("Couldn't send that request. Try again.");
    } finally {
      setSending(null);
    }
  }

  return (
    <section aria-labelledby="find-trips-heading" className="space-y-3">
      <div>
        <h2 id="find-trips-heading" className="font-serif text-2xl text-brand-teal">
          Find trips to join
        </h2>
        <p className="mt-1 text-sm text-text-subtle">
          Trips other travellers have opened up. The owner reviews every request.
        </p>
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setLoading(true);
        }}
        placeholder="Search by place, state, trip name or traveller…"
        aria-label="Search trips to join"
        className="w-full rounded-full border border-line-input bg-white px-4 py-2.5 text-sm outline-none focus:border-brand-teal"
      />

      {loading ? (
        <p className="text-sm text-text-subtle">Searching…</p>
      ) : trips.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-input p-6 text-center text-sm text-text-subtle">
          {query.trim()
            ? `No open trips match "${query.trim()}".`
            : "No open trips right now. Check back soon."}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {trips.map((trip) => (
            <li
              key={trip.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3.5"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar
                  name={trip.owner_name}
                  src={trip.owner_avatar_url}
                  seed={trip.owner_name}
                  size={36}
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-brand-teal">{trip.title}</p>
                  <p className="truncate text-xs text-text-subtle">
                    {[
                      trip.destination_name,
                      trip.start_date ?? "Dates TBD",
                      `by ${trip.owner_name}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={sending === trip.id || requested.has(trip.id)}
                onClick={() => askToJoin(trip)}
                className="shrink-0 rounded-full border border-[#d5d9d0] px-3.5 py-1.5 text-xs font-semibold text-brand-teal transition hover:border-brand-teal disabled:cursor-not-allowed disabled:opacity-60"
              >
                {requested.has(trip.id)
                  ? "Request sent"
                  : sending === trip.id
                    ? "Sending…"
                    : "Request to join"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
