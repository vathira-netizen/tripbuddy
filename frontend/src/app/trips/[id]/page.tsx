"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { toast } from "sonner";

import { Connection, initials, listConnections } from "@/lib/buddies";
import { ApiError } from "@/lib/api";
import { airbnbUrl, bookingComUrl, googleFlightsUrl, makeMyTripFlightsUrl } from "@/lib/booking";
import { BudgetSummary, fetchBudgetSummary, formatINR } from "@/lib/budget";
import { buildTripIcs, downloadIcs } from "@/lib/ics";
import {
  acceptJoinRequest,
  closeTripToJoin,
  declineJoinRequest,
  ItineraryItem,
  listJoinRequests,
  Trip,
  TripJoinRequest,
  dayLabels,
  getTrip,
  inviteCollaborator,
  listItineraryItems,
  openTripToJoin,
  shareTrip,
  shortDate,
  todayIso,
  unshareTrip,
} from "@/lib/trips";
import ItineraryBoard from "@/components/ItineraryBoard";
import AiItineraryPanel from "@/components/AiItineraryPanel";
import TripAssistantPanel from "@/components/TripAssistantPanel";
import TripCoverUpload from "@/components/TripCoverUpload";
import { TripChatThread } from "@/components/TripChatThread";
import { FormError } from "@/components/ui";

/** The first human-readable message in a DRF error body, if any. */
function apiMessage(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const find = (v: unknown): string | null => {
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return v.map(find).find(Boolean) ?? null;
    if (v && typeof v === "object") return Object.values(v).map(find).find(Boolean) ?? null;
    return null;
  };
  return find(err.data);
}

export default function TripPlannerPage() {
  const params = useParams<{ id: string }>();
  const tripId = Number(params.id);

  const [trip, setTrip] = useState<Trip | null>(null);
  const [items, setItems] = useState<ItineraryItem[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [budgetSummary, setBudgetSummary] = useState<BudgetSummary | null>(null);
  const [joinRequests, setJoinRequests] = useState<TripJoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingJoin, setTogglingJoin] = useState(false);
  const draggingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getTrip(tripId),
      listItineraryItems(tripId),
      listConnections({ status: "accepted" }).catch(() => [] as Connection[]),
      // Only feeds the print layout below — a failure there shouldn't block the page.
      fetchBudgetSummary(tripId).catch(() => null),
      listJoinRequests().catch(() => [] as TripJoinRequest[]),
    ])
      .then(([tripData, itemsData, conns, summary, requests]) => {
        if (cancelled) return;
        setTrip(tripData);
        setItems(itemsData);
        setConnections(conns);
        setBudgetSummary(summary);
        setJoinRequests(requests.filter((r) => r.trip === tripId && r.status === "pending"));
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

  function handleAddToCalendar() {
    if (!trip) return;
    const labels = dayLabels(trip.start_date, trip.nights);
    const ics = buildTripIcs(trip, items, labels, trip.start_date);
    downloadIcs(`${trip.title.replace(/[^\w\- ]+/g, "").trim() || "trip"}.ics`, ics);
  }

  async function toggleOpenToJoin() {
    if (!trip) return;
    setTogglingJoin(true);
    setError(null);
    try {
      const updated = trip.is_open_to_join
        ? await closeTripToJoin(tripId)
        : await openTripToJoin(tripId);
      setTrip(updated);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError("Only the trip creator can open or close this trip to join requests.");
      } else {
        setError(apiMessage(err) ?? "Couldn't update that. Try again.");
      }
    } finally {
      setTogglingJoin(false);
    }
  }

  /** Change the join deadline of an already-open trip ("" = until it starts). */
  async function saveJoinDeadline(value: string) {
    setTogglingJoin(true);
    setError(null);
    try {
      setTrip(await openTripToJoin(tripId, value));
    } catch (err) {
      setError(apiMessage(err) ?? "Couldn't save that deadline. Try again.");
    } finally {
      setTogglingJoin(false);
    }
  }

  async function respondToJoinRequest(
    request: TripJoinRequest,
    action: (id: number) => Promise<TripJoinRequest>,
  ) {
    try {
      await action(request.id);
      setJoinRequests((current) => current.filter((r) => r.id !== request.id));
      if (action === acceptJoinRequest) {
        toast.success(`${request.requester_name} joined the trip`);
        getTrip(tripId).then(setTrip).catch(() => {});
      }
    } catch {
      toast.error("That didn't go through. Try again.");
    }
  }

  async function toggleShare() {
    if (!trip) return;
    setError(null);
    try {
      const updated = trip.is_public
        ? await unshareTrip(tripId)
        : await shareTrip(tripId);
      setTrip(updated);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError("Only the trip creator can publish or revoke the public share link.");
      } else {
        setError("Couldn't update sharing. Try again.");
      }
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
      <div className="print:hidden">
        <TripCoverUpload
          tripId={tripId}
          coverImageUrl={trip.cover_image_url}
          onUploaded={(cover_image_url) => setTrip((t) => (t ? { ...t, cover_image_url } : t))}
        />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl leading-none tracking-tight">{trip.title}</h1>
          <p className="mt-1.5 text-sm text-text-subtle">
            {trip.start_date ?? "Dates TBD"}
            {trip.end_date ? ` – ${trip.end_date}` : ""} · {trip.nights} night
            {trip.nights === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <button
            type="button"
            onClick={handleAddToCalendar}
            className="rounded-full border border-[#c2c8c0] px-[18px] py-2 text-sm font-bold text-brand-teal transition hover:border-brand-teal"
          >
            Add to Calendar
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-full border border-[#c2c8c0] px-[18px] py-2 text-sm font-bold text-brand-teal transition hover:border-brand-teal"
          >
            Print / Save as PDF
          </button>
          <Link
            href={`/trips/${tripId}/budget`}
            className="rounded-full border border-[#c2c8c0] px-[18px] py-2 text-sm font-bold text-brand-teal transition hover:border-brand-teal"
          >
            Budget →
          </Link>
        </div>
      </div>

      {error && <FormError message={error} />}

      {/* Group chat: only meaningful once a friend has been added. */}
      {trip.collaborators.length > 0 && (
        <div className="print:hidden">
          <TripChatThread
            tripId={tripId}
            title={`${trip.title} — group chat`}
            members={[`${trip.collaborators.length + 1} members`]}
          />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 print:hidden">
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
                disabled={!trip.is_owner}
                title={
                  trip.is_owner
                    ? undefined
                    : "Only the trip creator can publish or revoke the public share link."
                }
                className="rounded-full border border-[#d5d9d0] px-4 py-1.5 text-sm font-semibold text-brand-teal transition hover:border-brand-teal disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[#d5d9d0]"
              >
                Stop sharing
              </button>
              {!trip.is_owner && (
                <p className="text-xs text-text-subtle">
                  Only the trip creator can publish or revoke the public share link.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-xs text-text-subtle">
                Publish a read-only link to show this plan to friends.
              </p>
              <button
                type="button"
                onClick={toggleShare}
                disabled={!trip.is_owner}
                title={
                  trip.is_owner
                    ? undefined
                    : "Only the trip creator can publish or revoke the public share link."
                }
                className="rounded-full bg-brand-teal px-4 py-1.5 text-sm font-bold text-background transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
              >
                Create share link
              </button>
              {!trip.is_owner && (
                <p className="text-xs text-text-subtle">
                  Only the trip creator can publish or revoke the public share link.
                </p>
              )}
            </>
          )}

          <div className="border-t border-line pt-3">
            <label className="flex items-center gap-2 text-sm text-brand-teal">
              <input
                type="checkbox"
                checked={trip.is_open_to_join}
                disabled={!trip.is_owner || togglingJoin}
                onChange={toggleOpenToJoin}
              />
              Open to join — let travellers browsing this destination ask to join
            </label>
            {trip.is_open_to_join &&
              (trip.is_owner ? (
                <label className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-subtle">
                  Deadline to join
                  <input
                    type="date"
                    value={trip.join_deadline ?? ""}
                    min={todayIso()}
                    max={trip.start_date ?? undefined}
                    disabled={togglingJoin}
                    onChange={(e) => saveJoinDeadline(e.target.value)}
                    className="rounded-lg border border-line-input bg-white px-2 py-1 text-xs text-foreground"
                  />
                  {!trip.join_deadline && <span>(blank: until the trip starts)</span>}
                </label>
              ) : (
                (trip.join_deadline ?? trip.start_date) && (
                  <p className="mt-2 text-xs text-text-subtle">
                    Join requests close on {shortDate((trip.join_deadline ?? trip.start_date)!)}.
                  </p>
                )
              ))}
          </div>
        </section>
      </div>

      {trip.is_owner && joinRequests.length > 0 && (
        <section className="space-y-3 rounded-2xl border border-line bg-surface p-4 print:hidden">
          <h2 className="text-xs font-bold uppercase tracking-wide text-brand-teal">
            Join requests
          </h2>
          <ul className="space-y-2">
            {joinRequests.map((request) => (
              <li
                key={request.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-line p-3"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    aria-hidden="true"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-teal text-xs font-bold text-background"
                  >
                    {initials(request.requester_name)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{request.requester_name}</p>
                    {request.message && (
                      <p className="truncate text-xs text-text-subtle">{request.message}</p>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => respondToJoinRequest(request, acceptJoinRequest)}
                    className="rounded-full bg-brand-teal px-3.5 py-1.5 text-xs font-bold text-background transition hover:brightness-90"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => respondToJoinRequest(request, declineJoinRequest)}
                    className="rounded-full border border-[#d5d9d0] px-3.5 py-1.5 text-xs font-semibold text-brand-teal transition hover:border-brand-teal"
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="print:hidden">
        <AiItineraryPanel
          tripId={tripId}
          hasBudget={trip.target_amount != null}
          onApplied={() => {
            listItineraryItems(tripId).then(setItems).catch(() => {});
          }}
        />
      </div>

      <div className="print:hidden">
        <TripAssistantPanel tripId={tripId} />
      </div>

      {/* Booking hand-off */}
      {trip.destination_name && (
        <section className="space-y-2 print:hidden">
          <h2 className="text-xs font-bold uppercase tracking-wide text-brand-teal">
            Book your trip
          </h2>
          <div className="flex flex-wrap gap-2 text-sm">
            <a
              href={googleFlightsUrl(trip.destination_name)}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-[#d5d9d0] px-4 py-1.5 font-semibold text-brand-teal transition hover:border-brand-teal"
            >
              Flights (Google Flights) →
            </a>
            <a
              href={makeMyTripFlightsUrl(trip.destination_name)}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-[#d5d9d0] px-4 py-1.5 font-semibold text-brand-teal transition hover:border-brand-teal"
            >
              Flights/Trains (MakeMyTrip) →
            </a>
            <a
              href={bookingComUrl(trip.destination_name, trip.start_date, trip.end_date)}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-[#d5d9d0] px-4 py-1.5 font-semibold text-brand-teal transition hover:border-brand-teal"
            >
              Stays (Booking.com) →
            </a>
            <a
              href={airbnbUrl(trip.destination_name, trip.start_date, trip.end_date)}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-[#d5d9d0] px-4 py-1.5 font-semibold text-brand-teal transition hover:border-brand-teal"
            >
              Stays (Airbnb) →
            </a>
          </div>
        </section>
      )}

      <section className="space-y-3 print:hidden">
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

      {/* Print-only: a clean, static rendering of the itinerary + budget —
          the interactive board above (drag handles, edit/delete buttons) is
          hidden when printing instead. */}
      <PrintSummary
        trip={trip}
        items={items}
        dayLabels={dayLabels(trip.start_date, trip.nights)}
        budgetSummary={budgetSummary}
      />
    </main>
  );
}

function PrintSummary({
  trip,
  items,
  dayLabels: labels,
  budgetSummary,
}: {
  trip: Trip;
  items: ItineraryItem[];
  dayLabels: string[];
  budgetSummary: BudgetSummary | null;
}) {
  const byDay = labels.map((label, day) => ({
    label,
    items: items
      .filter((it) => it.day_index === day)
      .sort((a, b) => a.position - b.position),
  }));

  return (
    <section className="hidden print:block">
      <h2 className="text-lg font-bold text-brand-teal">Day-by-day itinerary</h2>
      {byDay.map(({ label, items: dayItems }) => (
        <div key={label} className="mt-3">
          <h3 className="font-semibold">{label}</h3>
          {dayItems.length === 0 ? (
            <p className="text-sm text-text-subtle">Nothing planned yet.</p>
          ) : (
            <ul className="ml-4 list-disc text-sm">
              {dayItems.map((it) => (
                <li key={it.id}>
                  {it.title}
                  {it.notes && ` — ${it.notes}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {budgetSummary && (
        <div className="mt-6">
          <h2 className="text-lg font-bold text-brand-teal">Budget summary</h2>
          <p className="text-sm">
            Total spent: {formatINR(budgetSummary.running_total.total)}
            {budgetSummary.running_total.target != null &&
              ` of ${formatINR(budgetSummary.running_total.target)} budgeted`}
          </p>
          <ul className="ml-4 list-disc text-sm">
            {Object.entries(budgetSummary.category_totals).map(([category, amount]) => (
              <li key={category}>
                {category}: {formatINR(amount)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-6 text-xs text-text-subtle">
        {trip.title} — exported from TripBuddy
      </p>
    </section>
  );
}
