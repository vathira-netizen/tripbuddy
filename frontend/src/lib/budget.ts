import { api, apiFetchBlob } from "@/lib/api";

/** Mirrors BudgetItem.Category on the backend (apps/budgets/models.py). */
export const BUDGET_CATEGORIES = [
  "Transport",
  "Stay",
  "Food",
  "Activities",
  "Other",
] as const;
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];

/** Amounts come back from DRF's DecimalField as strings, not numbers. */
export interface BudgetItem {
  id: number;
  trip: number;
  category: BudgetCategory;
  label: string;
  amount: string;
  payer: number | null;
  /** Read-only: the payer's display name, resolved server-side. */
  payer_name: string | null;
  payer_avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export type BudgetItemInput = Pick<BudgetItem, "category" | "label" | "amount"> & {
  payer?: number | null;
};

export interface PerMemberSplit {
  paid: string;
  owed: string;
  balance: string;
}

/** One trip member, keyed by their Django user id (as a string) in BudgetSummary.members. */
export interface BudgetMember {
  display_name: string;
  avatar_url: string;
  /** Only meaningful to the requester's fellow trip members — never public. */
  upi_vpa: string;
  is_owner: boolean;
  /** True on the entry belonging to the requesting user. */
  is_me: boolean;
}

/** One minimal-transaction settlement — member ids match BudgetSummary.members keys. */
export interface Settlement {
  from_user: number;
  to_user: number;
  amount: string;
}

export interface BudgetSummary {
  trip_id: number;
  nights: number;
  category_totals: Record<BudgetCategory, string>;
  per_day: {
    total_per_day: string;
    category_per_day: Record<BudgetCategory, string>;
  };
  per_person: {
    total: string;
    equal_share: string;
    per_member: Record<string, PerMemberSplit>;
  };
  /** Minimal set of payments that would settle every balance to zero. */
  settlements: Settlement[];
  /** Trip member id -> name/avatar, for labelling per_person and payer pickers. */
  members: Record<string, BudgetMember>;
  running_total: {
    total: string;
    target: string | null;
    remaining: string | null;
    over_budget: boolean;
  };
}

interface Page<T> {
  results: T[];
}

export const listBudgetItems = (tripId: number) =>
  api
    .get<Page<BudgetItem>>(`/api/budget-items/?trip=${tripId}`)
    .then((p) => p.results);

export const createBudgetItem = (tripId: number, input: BudgetItemInput) =>
  api.post<BudgetItem>("/api/budget-items/", { trip: tripId, ...input });

export const updateBudgetItem = (id: number, input: Partial<BudgetItemInput>) =>
  api.patch<BudgetItem>(`/api/budget-items/${id}/`, input);

export const deleteBudgetItem = (id: number) =>
  api.delete(`/api/budget-items/${id}/`);

export const fetchBudgetSummary = (tripId: number) =>
  api.get<BudgetSummary>(`/api/trips/${tripId}/budget-summary/`);

/** Fetches the CSV export and triggers a browser download named after the trip. */
export async function downloadBudgetCsv(tripId: number) {
  const blob = await apiFetchBlob(`/api/trips/${tripId}/budget.csv/`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `trip-${tripId}-budget.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

/** ₹1,23,456.00 — Indian digit grouping, budget figures keep paise. */
export const formatINR = (amount: string | number) => inr.format(Number(amount));
