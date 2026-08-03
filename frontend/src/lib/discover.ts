import { api } from "@/lib/api";

/** A destination as returned by the Django discovery API. */
export interface Destination {
  id: number;
  name: string;
  slug: string;
  lat: number;
  lng: number;
  avg_daily_budget: number;
  budget_tier: "budget" | "mid" | "comfort";
  interest_tags: string[];
  best_season: string;
  region: string;
  image_url: string;
  distance_km: number | null;
}

export interface SavedDestination {
  id: number;
  destination: Destination;
  created_at: string;
}

interface Page<T> {
  results: T[];
}

/** Regions present in the seed catalogue — used by the discover filter. */
export const REGIONS = [
  "North",
  "South",
  "East",
  "West",
  "Northeast",
  "Central",
  "Islands",
] as const;

export const TIER_LABELS: Record<Destination["budget_tier"], string> = {
  budget: "Budget",
  mid: "Mid-range",
  comfort: "Comfort",
};

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** ₹1,23,456 — Indian digit grouping. */
export const formatINR = (amount: number) => inr.format(amount);

export interface DestinationFilters {
  minBudget?: number;
  maxBudget?: number;
  region?: string;
  interests?: string[];
  ordering?: string;
}

function buildQuery(f: DestinationFilters): string {
  const q = new URLSearchParams();
  if (f.minBudget) q.set("min_budget", String(f.minBudget));
  if (f.maxBudget) q.set("max_budget", String(f.maxBudget));
  if (f.region) q.set("region", f.region);
  if (f.interests?.length) q.set("interests", f.interests.join(","));
  if (f.ordering) q.set("ordering", f.ordering);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export const listDestinations = (f: DestinationFilters) =>
  api.get<Page<Destination>>(`/api/destinations/${buildQuery(f)}`).then((p) => p.results);

export const nearbyDestinations = (lat: number, lng: number, radiusKm = 500) =>
  api.get<Destination[]>(
    `/api/destinations/nearby/?lat=${lat}&lng=${lng}&radius_km=${radiusKm}`,
  );

export const listSaved = () =>
  api.get<Page<SavedDestination>>("/api/saved-destinations/").then((p) => p.results);

export const saveDestination = (destinationId: number) =>
  api.post<SavedDestination>("/api/saved-destinations/", { destination_id: destinationId });

export const unsaveDestination = (savedId: number) =>
  api.delete(`/api/saved-destinations/${savedId}/`);
