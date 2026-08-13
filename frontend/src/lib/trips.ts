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
  start_date: string | null;
  end_date: string | null;
  target_amount: string | null;
  nights: number;
  is_public: boolean;
  share_token: string;
  collaborators: Collaborator[];
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

// --- AI itinerary generation (Phase 6) --------------------------------------
// The Grok key lives only on the Django server; the browser only ever sees the
// already-generated, budget-validated draft below.

export interface AiDraftItem {
  title: string;
  category: string;
  est_cost: string;
  location: string;
  notes: string;
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
}

export interface GenerateParams {
  style?: string;
  transport_pref?: string;
  accommodation_pref?: string;
}

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
