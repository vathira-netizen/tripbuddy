"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { Connection, listConnections } from "@/lib/buddies";
import {
  ItineraryItem,
  Trip,
  dayLabels,
  getTrip,
  inviteCollaborator,
  listItineraryItems,
  shareTrip,
  unshareTrip,
} from "@/lib/trips";
import ItineraryBoard from "@/components/ItineraryBoard";

export default function TripPlannerPage() {
  const params = useParams<{ id: string }>();
  const tripId = Number(params.id);

  const [trip, setTrip] = useState<Trip | null>(null);
  const [items, setItems] = useState<ItineraryItem[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getTrip(tripId),
      listItineraryItems(tripId),
      listConnections({ status: "accepted" }).catch(() => [] as Connection[]),
    ])
      .then(([tripData, itemsData, conns]) => {
        if (cancelled) return;
        setTrip(tripData);
        setItems(itemsData);
        setConnections(conns);
      })
      .catch(() => !cancelled && setError("Couldn't load this trip."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  // Refetch on window focus and on a gentle interval so a collaborator's edits
  // appear without a manual reload — paused mid-drag so we don't clobber it.
  useEffect(() => {
    const refresh = () => {
      if (draggingRef.current) return;
      listItineraryItems(tripId)
        .then((fresh) => !draggingRef.current && setItems(fresh))
        .catch(() => {});
    };
    const interval = setInterval(() => {
      if (document.hasFocus()) refresh();
    }, 8000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [tripId]);

  const handleInvite = useCallback(
    async (supabaseUserId: string) => {
      setError(null);
      try {
        const updated = await inviteCollaborator(tripId, supabaseUserId);
        setTrip(updated);
      } catch {
        setError("Couldn't add that collaborator.");
      }
    },
    [tripId],
  );

  async function toggleShare() {
    if (!trip) return;
    setError(null);
    try {
      const updated = trip.is_public
        ? await unshareTrip(tripId)
        : await shareTrip(tripId);
      setTrip(updated);
    } catch {
      setError("Couldn't update sharing.");
    }
  }

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <p className="text-sm text-black/60 dark:text-white/60">Loading…</p>
      </main>
    );
  }

  if (!trip) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          {error ?? "Couldn't load this trip."}
        </p>
      </main>
    );
  }

  const collaboratorIds = new Set(
    trip.collaborators.map((c) => c.supabase_user_id),
  );
  const invitable = connections.filter(
    (c) => c.other && !collaboratorIds.has(c.other.supabase_user_id),
  );
  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/share/${trip.share_token}`
      : "";

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{trip.title}</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            {trip.start_date ?? "Dates TBD"}
            {trip.end_date ? ` – ${trip.end_date}` : ""} · {trip.nights} night
            {trip.nights === 1 ? "" : "s"}
          </p>
        </div>
        <Link
          href={`/trips/${tripId}/budget`}
          className="rounded-lg border border-black/15 px-4 py-2 text-sm font-medium transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
        >
          Budget →
        </Link>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Collaborators */}
        <section className="space-y-3 rounded-xl border border-black/10 p-4 dark:border-white/10">
          <h2 className="text-sm font-semibold">Collaborators</h2>
          <ul className="space-y-1 text-sm">
            {trip.collaborators.length === 0 && (
              <li className="text-black/50 dark:text-white/50">
                Just you so far.
              </li>
            )}
            {trip.collaborators.map((c) => (
              <li key={c.id}>{c.display_name}</li>
            ))}
          </ul>
          {invitable.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {invitable.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleInvite(c.other!.supabase_user_id)}
                  className="rounded-full border border-black/15 px-3 py-1 text-xs transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                >
                  + {c.other!.display_name}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-black/50 dark:text-white/50">
              Connect with travellers on the Buddies page to invite them here.
            </p>
          )}
        </section>

        {/* Sharing */}
        <section className="space-y-3 rounded-xl border border-black/10 p-4 dark:border-white/10">
          <h2 className="text-sm font-semibold">Share</h2>
          {trip.is_public ? (
            <>
              <p className="text-xs text-black/60 dark:text-white/60">
                Anyone with this link can view (not edit) the itinerary.
              </p>
              <input
                readOnly
                value={shareUrl}
                onFocus={(e) => e.target.select()}
                aria-label="Public share link"
                className="w-full rounded-md border border-black/15 bg-transparent px-2 py-1 text-xs dark:border-white/20"
              />
              <button
                type="button"
                onClick={toggleShare}
                className="rounded-lg border border-black/15 px-3 py-1.5 text-sm transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              >
                Stop sharing
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-black/60 dark:text-white/60">
                Publish a read-only link to show this plan to friends.
              </p>
              <button
                type="button"
                onClick={toggleShare}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700"
              >
                Create share link
              </button>
            </>
          )}
        </section>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Itinerary</h2>
        <ItineraryBoard
          tripId={tripId}
          dayLabels={dayLabels(trip.start_date, trip.nights)}
          items={items}
          onItemsChange={setItems}
          onDraggingChange={(d) => {
            draggingRef.current = d;
          }}
          onError={setError}
        />
      </section>
    </main>
  );
}
