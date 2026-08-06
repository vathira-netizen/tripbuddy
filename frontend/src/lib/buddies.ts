import { api } from "@/lib/api";

/**
 * Travel-buddy matching and connections.
 *
 * Note what a candidate deliberately does *not* carry: no coordinates and no
 * measured distance. The backend sends `area_label` (the city the traveller
 * typed) and a coarse `distance_bucket` string, and this module must never try
 * to reconstruct anything finer.
 */

export interface Explanation {
  /** G | J | B | L | A | D — see backend/apps/matching/compatibility.py */
  component: string;
  label: string;
  score: number;
  /** This component's share of the 0–100 score. */
  contribution: number;
}

export interface BuddyCandidate {
  supabase_user_id: string;
  display_name: string;
  age_band: string;
  gender: string;
  languages: string[];
  interests: string[];
  budget_style: "budget" | "mid" | "comfort" | "";
  /** Approximate area, e.g. "Bengaluru, Karnataka". */
  area_label: string;
  /** A coarse band such as "10–25 km", never an exact distance. */
  distance_bucket: string;
  score: number;
  explanation: Explanation[];
}

export interface BuddyPage {
  radius_km: number;
  count: number;
  results: BuddyCandidate[];
}

export type ConnectionStatus = "pending" | "accepted" | "declined" | "blocked";

export interface ConnectionParticipant {
  supabase_user_id: string;
  display_name: string;
  age_band: string;
  gender: string;
  languages: string[];
  interests: string[];
  budget_style: string;
  area_label: string;
}

export interface Connection {
  id: number;
  status: ConnectionStatus;
  other: ConnectionParticipant | null;
  direction: "incoming" | "outgoing";
  /** True only when the current user may accept/decline this request. */
  can_act: boolean;
  created_at: string;
  updated_at: string;
}

interface Page<T> {
  results: T[];
}

/** Radius options for the selector, in km. Matches the backend's 1–2000 bounds. */
export const RADIUS_OPTIONS = [25, 50, 100, 150, 300, 500, 1000, 2000] as const;

export const DEFAULT_RADIUS_KM = 150;

export interface BuddyFilters {
  radiusKm?: number;
  gender?: string;
  ageBand?: string;
  destination?: number;
}

function buildQuery(f: BuddyFilters): string {
  const q = new URLSearchParams();
  if (f.radiusKm) q.set("radius_km", String(f.radiusKm));
  if (f.gender) q.set("gender", f.gender);
  if (f.ageBand) q.set("age_band", f.ageBand);
  if (f.destination) q.set("destination", String(f.destination));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export const listBuddies = (f: BuddyFilters) =>
  api.get<BuddyPage>(`/api/buddies/${buildQuery(f)}`);

export const sendConnectionRequest = (supabaseUserId: string) =>
  api.post<Connection>("/api/connections/", { supabase_user_id: supabaseUserId });

export const listConnections = (params?: {
  direction?: "incoming" | "outgoing";
  status?: ConnectionStatus;
}) => {
  const q = new URLSearchParams();
  if (params?.direction) q.set("direction", params.direction);
  if (params?.status) q.set("status", params.status);
  const s = q.toString();
  return api
    .get<Page<Connection>>(`/api/connections/${s ? `?${s}` : ""}`)
    .then((p) => p.results);
};

export const acceptConnection = (id: number) =>
  api.post<Connection>(`/api/connections/${id}/accept/`, {});

export const declineConnection = (id: number) =>
  api.post<Connection>(`/api/connections/${id}/decline/`, {});

export const blockConnection = (id: number) =>
  api.post<Connection>(`/api/connections/${id}/block/`, {});

/**
 * Initials for the avatar placeholder. Profiles have no photo field yet, so
 * every avatar is generated from the display name.
 */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Deterministic avatar tint, so the same person keeps the same colour. */
export function avatarTint(seed: string): string {
  const palette = [
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
    "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
    "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length];
}

export const BUDGET_STYLE_LABELS: Record<string, string> = {
  budget: "Budget",
  mid: "Mid-range",
  comfort: "Comfort",
};
