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
  state: string;
  image_url: string;
  /** Extra gallery photos beyond image_url, same placeholder convention. */
  image_urls: string[];
  /** Wikipedia page the photos come from (Commons licences require credit). */
  image_credit: string;
  description: string;
  distance_km: number | null;
  avg_rating: number | null;
  review_count: number;
}

export interface DestinationReview {
  id: number;
  destination: number;
  author_name: string;
  author_avatar_url: string;
  rating: number;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface SavedDestination {
  id: number;
  destination: Destination;
  created_at: string;
}

interface Page<T> {
  results: T[];
  count: number;
}

/** Matches the API's PAGE_SIZE (config/settings.py). */
export const DISCOVER_PAGE_SIZE = 20;

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

export const STATES = [
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Meghalaya",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
] as const;

// Starting cities for the distance shortlist (lat, lng).
export const START_CITIES: Record<string, [number, number]> = {
  Ahmedabad: [23.0225, 72.5714],
  Bengaluru: [12.9716, 77.5946],
  Bhopal: [23.2599, 77.4126],
  Chandigarh: [30.7333, 76.7794],
  Chennai: [13.0827, 80.2707],
  Delhi: [28.6139, 77.209],
  Guwahati: [26.1445, 91.7362],
  Hyderabad: [17.385, 78.4867],
  Jaipur: [26.9124, 75.7873],
  Kochi: [9.9312, 76.2673],
  Kolkata: [22.5726, 88.3639],
  Lucknow: [26.8467, 80.9462],
  Mumbai: [19.076, 72.8777],
  Pune: [18.5204, 73.8567],
};

export const DISTANCE_LIMITS = [100, 250, 500, 1000, 2000] as const;

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
  state?: string;
  interests?: string[];
  ordering?: string;
  page?: number;
  /** Starting point [lat, lng]: destinations within ~40 km of it are left out. */
  excludeNear?: [number, number];
}

function buildQuery(f: DestinationFilters): string {
  const q = new URLSearchParams();
  if (f.minBudget) q.set("min_budget", String(f.minBudget));
  if (f.maxBudget) q.set("max_budget", String(f.maxBudget));
  if (f.region) q.set("region", f.region);
  if (f.state) q.set("state", f.state);
  if (f.interests?.length) q.set("interests", f.interests.join(","));
  if (f.ordering) q.set("ordering", f.ordering);
  if (f.page && f.page > 1) q.set("page", String(f.page));
  if (f.excludeNear) q.set("exclude_near", f.excludeNear.join(","));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export const listDestinations = (f: DestinationFilters) =>
  api.get<Page<Destination>>(`/api/destinations/${buildQuery(f)}`).then((p) => p.results);

/** One page of results plus the total, for the paginated Discover grid. */
export const listDestinationsPage = (f: DestinationFilters) =>
  api.get<Page<Destination>>(`/api/destinations/${buildQuery(f)}`);

export const getDestination = (slug: string) =>
  api.get<Destination>(`/api/destinations/${slug}/`);

/** Nearest first, leaving out the starting city itself (see excludeNear). */
export const nearbyDestinations = (lat: number, lng: number, radiusKm = 500) =>
  api.get<Destination[]>(
    `/api/destinations/nearby/?lat=${lat}&lng=${lng}&radius_km=${radiusKm}&exclude_near=${lat},${lng}`,
  );

export const listSaved = () =>
  api.get<Page<SavedDestination>>("/api/saved-destinations/").then((p) => p.results);

export const saveDestination = (destinationId: number) =>
  api.post<SavedDestination>("/api/saved-destinations/", { destination_id: destinationId });

export const unsaveDestination = (savedId: number) =>
  api.delete(`/api/saved-destinations/${savedId}/`);

// --- Reviews (P4) -------------------------------------------------------------

export const listReviews = (destinationId: number) =>
  api
    .get<Page<DestinationReview>>(`/api/destination-reviews/?destination=${destinationId}`)
    .then((p) => p.results);

/** Creates your review, or edits it in place if you already left one. */
export const submitReview = (destinationId: number, rating: number, body: string) =>
  api.post<DestinationReview>("/api/destination-reviews/", {
    destination: destinationId,
    rating,
    body,
  });

export const deleteReview = (reviewId: number) =>
  api.delete<void>(`/api/destination-reviews/${reviewId}/`);
