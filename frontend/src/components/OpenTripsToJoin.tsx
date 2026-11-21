"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { avatarTint, initials } from "@/lib/buddies";
import {
  listJoinRequests,
  listOpenTrips,
  OpenTrip,
  requestToJoinTrip,
  shortDate,
} from "@/lib/trips";

/** Trips to this destination whose owner has opted in to join requests. */
export default function OpenTripsToJoin({
  destinationId,
  destinationName,
}: {
  destinationId: number;
  destinationName: string;
}) {
  const [trips, setTrips] = useState<OpenTrip[]>([]);
  const [requested, setRequested] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listOpenTrips(destinationId),
      listJoinRequests().catch(() => []),
    ])
      .then(([openTrips, mine]) => {
        if (cancelled) return;
        setTrips(openTrips);
        setRequested(
          new Set(
            mine
              .filter((r) => r.status === "pending" && openTrips.some((t) => t.id === r.trip))
              .map((r) => r.trip),
          ),
        );
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [destinationId]);

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

  if (loading || trips.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-bold uppercase tracking-wide text-brand-teal">
        Trips open to join
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {trips.map((trip) => (
          <li
            key={trip.id}
            className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3.5"
          >
            <Link href={`/trips/${trip.id}`} className="flex min-w-0 items-center gap-2.5">
              {trip.owner_avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- user-supplied external URL
                <img
                  src={trip.owner_avatar_url}
                  alt=""
                  className="h-9 w-9 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold ${avatarTint(
                    trip.owner_name,
                  )}`}
                >
                  {initials(trip.owner_name)}
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-brand-teal">{trip.title}</p>
                <p className="truncate text-xs text-text-subtle">
                  {trip.owner_name} · {trip.start_date ?? "Dates TBD"}
                  {trip.join_deadline && ` · join by ${shortDate(trip.join_deadline)}`}
                  {trip.collaborator_count > 0 &&
                    ` · ${trip.collaborator_count} traveller${trip.collaborator_count === 1 ? "" : "s"}`}
                </p>
              </div>
            </Link>
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
                  : `Request to join`}
            </button>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-text-subtle">
        Trip owners in {destinationName} who opted in to join requests — the owner reviews
        every request before you&apos;re added.
      </p>
    </section>
  );
}
