"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { Connection, initials, listConnections } from "@/lib/buddies";
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
import AiItineraryPanel from "@/components/AiItineraryPanel";
import { FormError } from "@/components/ui";

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
        <p className="text-sm text-text-subtle">Loading…</p>
      </main>
    );
  }

  if (!trip) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <FormError message={error ?? "Couldn't load this trip."} />
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl leading-none tracking-tight">{trip.title}</h1>
          <p className="mt-1.5 text-sm text-text-subtle">
            {trip.start_date ?? "Dates TBD"}
            {trip.end_date ? ` – ${trip.end_date}` : ""} · {trip.nights} night
            {trip.nights === 1 ? "" : "s"}
          </p>
        </div>
        <Link
          href={`/trips/${tripId}/budget`}
          className="rounded-full border border-[#c2c8c0] px-[18px] py-2 text-sm font-bold text-brand-teal transition hover:border-brand-teal"
        >
          Budget →
        </Link>
      </div>

      {error && <FormError message={error} />}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Collaborators */}
        <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-brand-teal">
            Collaborators
          </h2>
          {trip.collaborators.length === 0 ? (
            <p className="text-sm text-text-subtle">Just you so far.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {trip.collaborators.map((c, i) => (
                <span
                  key={c.id}
                  title={c.display_name}
                  className={`grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full text-xs font-bold ${
                    i % 2 === 0 ? "bg-brand-coral text-white" : "bg-brand-teal text-background"
                  }`}
                >
                  {initials(c.display_name)}
                </span>
              ))}
              <span className="ml-1 text-sm text-text-muted">
                {trip.collaborators.map((c) => c.display_name).join(", ")}
              </span>
            </div>
          )}
          {invitable.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {invitable.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleInvite(c.other!.supabase_user_id)}
                  className="rounded-full border border-[#d5d9d0] px-3 py-1.5 text-xs font-semibold text-brand-teal transition hover:border-brand-teal"
                >
                  + {c.other!.display_name}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-subtle">
              Connect with travellers on the Buddies page to invite them here.
            </p>
          )}
        </section>

        {/* Sharing */}
        <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-brand-teal">Share</h2>
          {trip.is_public ? (
            <>
              <p className="text-xs text-text-subtle">
                Anyone with this link can view (not edit) the itinerary.
              </p>
              <input
                readOnly
                value={shareUrl}
                onFocus={(e) => e.target.select()}
                aria-label="Public share link"
                className="w-full rounded-xl border border-line-input bg-white px-2.5 py-1.5 text-xs"
              />
              <button
                type="button"
                onClick={toggleShare}
                className="rounded-full border border-[#d5d9d0] px-4 py-1.5 text-sm font-semibold text-brand-teal transition hover:border-brand-teal"
              >
                Stop sharing
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-text-subtle">
                Publish a read-only link to show this plan to friends.
              </p>
              <button
                type="button"
                onClick={toggleShare}
                className="rounded-full bg-brand-teal px-4 py-1.5 text-sm font-bold text-background transition hover:brightness-90"
              >
                Create share link
              </button>
            </>
          )}
        </section>
      </div>

      <AiItineraryPanel
        tripId={tripId}
        onApplied={() => {
          listItineraryItems(tripId).then(setItems).catch(() => {});
        }}
      />

      <section className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wide text-brand-teal">
          Itinerary
        </h2>
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
