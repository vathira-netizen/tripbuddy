import { api } from "@/lib/api";

/**
 * Trips, itinerary items, collaborators and read-only sharing (Phase 5).
 *
 * Collaborative consistency here is refetch-based, not push: the board polls
 * `listItineraryItems` (see app/trips/[id]/page.tsx), so a co-editor's change
 * shows up without a manual reload. No Supabase Realtime or direct browser
 * reads are involved — every call goes through the authorised Django API.
 */

export type CollaboratorRole = "owner" | "editor" | "viewer";

export interface Collaborator {
  id: number;
  supabase_user_id: string | null;
  display_name: string;
  role: CollaboratorRole;
  created_at: string;
}

export interface Trip {
  id: number;
  owner: number;
  title: string;
  destination: number | null;
  destination_name: string | null;
  start_date: string | null;
  end_date: string | null;
  target_amount: string | null;
  nights: number;
  is_public: boolean;
  share_token: string;
  cover_image_url: string;
  /** Read-only here — toggled only through openTripToJoin/closeTripToJoin. */
  is_open_to_join: boolean;
  /** Last day join requests are accepted; null = until the trip starts. */
  join_deadline: string | null;
  collaborators: Collaborator[];
  is_owner: boolean;
  created_at: string;
}

/** A trip browsed from its destination page by a non-member — narrow shape. */
export interface OpenTrip {
  id: number;
  title: string;
  /** Empty when the trip has no destination picked yet. */
  destination_name: string;
  destination_slug: string;
  start_date: string | null;
  end_date: string | null;
  nights: number;
  /** Effective last day to ask (the start date if no deadline); null = open-ended. */
  join_deadline: string | null;
  owner_name: string;
  owner_avatar_url: string;
  collaborator_count: number;
}

export type JoinRequestStatus = "pending" | "accepted" | "declined";

export interface TripJoinRequest {
  id: number;
  trip: number;
  requester_name: string;
  requester_avatar_url: string;
  status: JoinRequestStatus;
  message: string;
  created_at: string;
}

export interface ItineraryItem {
  id: number;
  trip: number;
  day_index: number;
  position: number;
  title: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

/** The public, unauthenticated view served at /api/share/{token}/. */
export interface SharedTrip {
  title: string;
  start_date: string | null;
  end_date: string | null;
  nights: number;
  owner_name: string;
  itinerary_items: Pick<
    ItineraryItem,
    "day_index" | "position" | "title" | "notes"
  >[];
}

interface Page<T> {
  results: T[];
}

// --- Trips ------------------------------------------------------------------

export const listTrips = () =>
  api.get<Page<Trip>>("/api/trips/").then((p) => p.results);

export const getTrip = (id: number) => api.get<Trip>(`/api/trips/${id}/`);

export interface TripInput {
  title: string;
  destination?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  target_amount?: string | null;
  cover_image_url?: string | null;
}

export const createTrip = (input: TripInput) =>
  api.post<Trip>("/api/trips/", input);

export const updateTrip = (id: number, patch: Partial<TripInput>) =>
  api.patch<Trip>(`/api/trips/${id}/`, patch);

export const deleteTrip = (id: number) => api.delete<void>(`/api/trips/${id}/`);

// --- Itinerary items --------------------------------------------------------

export const listItineraryItems = (tripId: number) =>
  api
    .get<Page<ItineraryItem>>(`/api/itinerary-items/?trip=${tripId}`)
    .then((p) => p.results);

export const createItineraryItem = (input: {
  trip: number;
  day_index: number;
  position: number;
  title: string;
  notes?: string;
}) => api.post<ItineraryItem>("/api/itinerary-items/", input);

export const updateItineraryItem = (
  id: number,
  patch: Partial<Pick<ItineraryItem, "title" | "notes" | "day_index" | "position">>,
) => api.patch<ItineraryItem>(`/api/itinerary-items/${id}/`, patch);

export const deleteItineraryItem = (id: number) =>
  api.delete<void>(`/api/itinerary-items/${id}/`);

/** Persist a new (day_index, position) for a set of items in one request. */
export const reorderItinerary = (
  tripId: number,
  items: { id: number; day_index: number; position: number }[],
) => api.post<ItineraryItem[]>(`/api/trips/${tripId}/reorder/`, { items });

// --- Collaborators & sharing ------------------------------------------------

export const inviteCollaborator = (tripId: number, supabaseUserId: string) =>
  api.post<Trip>(`/api/trips/${tripId}/invite/`, {
    supabase_user_id: supabaseUserId,
  });

export const shareTrip = (tripId: number) =>
  api.post<Trip>(`/api/trips/${tripId}/share/`, {});

export const unshareTrip = (tripId: number) =>
  api.post<Trip>(`/api/trips/${tripId}/unshare/`, {});

/** No auth needed; works for logged-out viewers of a public trip. */
export const getSharedTrip = (token: string) =>
  api.get<SharedTrip>(`/api/share/${token}/`);

// --- Open to join / join requests (P4) ---------------------------------------

/** Open (or, if already open, update the deadline of) a trip to join requests. */
export const openTripToJoin = (tripId: number, joinDeadline?: string | null) =>
  api.post<Trip>(`/api/trips/${tripId}/open-to-join/`, {
    join_deadline: joinDeadline || null,
  });

export const closeTripToJoin = (tripId: number) =>
  api.post<Trip>(`/api/trips/${tripId}/close-to-join/`, {});

/** Trips open to join, optionally filtered to one destination. */
export const listOpenTrips = (destinationId?: number) =>
  api.get<OpenTrip[]>(
    `/api/trips/open/${destinationId ? `?destination=${destinationId}` : ""}`,
  );

/** Search every open-to-join trip by title, destination, state or owner. */
export const searchOpenTrips = (q: string) =>
  api.get<OpenTrip[]>(
    `/api/trips/open/?exclude_mine=true${q ? `&q=${encodeURIComponent(q)}` : ""}`,
  );

export const requestToJoinTrip = (tripId: number, message?: string) =>
  api.post<TripJoinRequest>("/api/trip-join-requests/", {
    trip: tripId,
    message: message ?? "",
  });

/** Every join request visible to you — sent by you, or received as a trip owner. */
export const listJoinRequests = () =>
  api
    .get<Page<TripJoinRequest>>("/api/trip-join-requests/")
    .then((p) => p.results);

export const acceptJoinRequest = (id: number) =>
  api.post<TripJoinRequest>(`/api/trip-join-requests/${id}/accept/`, {});

export const declineJoinRequest = (id: number) =>
  api.post<TripJoinRequest>(`/api/trip-join-requests/${id}/decline/`, {});

// --- AI itinerary generation (Phase 6) --------------------------------------
// The Grok key lives only on the Django server; the browser only ever sees the
// already-generated, budget-validated draft below.

export interface AiDraftItem {
  title: string;
  category: string;
  est_cost: string;
  location: string;
  notes: string;
  /** Reasons this item's cost looked off for the destination's typical
   * spend ("cost_high" / "cost_low") — a plausibility check against our own
   * catalogue data, not a claim that the venue was verified to exist. */
  flags: string[];
}

export interface AiDraftDay {
  day_index: number;
  items: AiDraftItem[];
}

export interface AiDraft {
  days: AiDraftDay[];
  target: string | null;
  total: string;
  over_budget: boolean;
  per_category: Record<string, string>;
  offending_items: AiDraftItem[];
  provider: string;
  model: string;
  /** Whether the destination catalogue had facts (typical spend, tags,
   * season) to ground this plan in at all. */
  grounded: boolean;
  /** Plan-level cautions, e.g. dates falling outside the destination's
   * usual best season. Empty when there's nothing to flag. */
  advisories: string[];
  /** Always shown: no plan's specific venues are verified against a live
   * database, grounded or not. */
  disclaimer: string;
}

export interface GenerateParams {
  style?: string;
  transport_pref?: string;
  accommodation_pref?: string;
}

export interface AssistantReply {
  answer: string;
  /** Present only when the user asked for a plan; already budget-checked. */
  plan: {
    days: AiDraftDay[];
    target: string | null;
    total: string;
    over_budget: boolean;
    offending_items: AiDraftItem[];
    disclaimer: string;
  } | null;
}

export const askAssistant = (tripId: number, question: string) =>
  api.post<AssistantReply>(`/api/trips/${tripId}/ask/`, { question });

export const generateItinerary = (tripId: number, params: GenerateParams) =>
  api.post<AiDraft>(`/api/trips/${tripId}/generate-itinerary/`, params);

export const applyItinerary = (
  tripId: number,
  days: AiDraftDay[],
  addToBudget: boolean,
) =>
  api.post<ItineraryItem[]>(`/api/trips/${tripId}/apply-itinerary/`, {
    days,
    add_to_budget: addToBudget,
  });

/** Today as YYYY-MM-DD in the viewer's timezone — the format date inputs use. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** "12 Dec" from a YYYY-MM-DD date, without timezone drift. */
export function shortDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/** Past trips have ended (or, undated-end, started) before today. */
export function isPastTrip(trip: Pick<Trip, "start_date" | "end_date">): boolean {
  const last = trip.end_date ?? trip.start_date;
  return last !== null && last < todayIso();
}

/** Day column labels from a trip's date range, falling back to "Day N". */
export function dayLabels(
  startDate: string | null,
  nights: number,
): string[] {
  const count = Math.max(nights + 1, 1);
  const start = startDate ? new Date(startDate + "T00:00:00") : null;
  return Array.from({ length: count }, (_, i) => {
    if (!start) return `Day ${i + 1}`;
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  });
}
