import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";

/**
 * Thin fetch wrapper around the Django API.
 *
 * Attaches the current Supabase access token as `Authorization: Bearer <jwt>`
 * on every request — this is exactly the token Django re-verifies in
 * `apps.accounts.authentication`. Intended for Client Components.
 */

// Falls back to the known-working Render backend (not localhost) — a stale or
// misconfigured NEXT_PUBLIC_API_URL on the hosting platform must not silently
// route production traffic to a dead/unconfigured backend.
const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://tripbuddy-backend-1387.onrender.com";

export class ApiError extends Error {
  status: number;
  /** Parsed JSON body of the error response, when there is one. */
  data: unknown;

  constructor(status: number, data: unknown, message?: string) {
    super(message ?? `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session ? { Authorization: `Bearer ${session.access_token}` } : {};
}

/**
 * One retry for GETs that die on the network or a 502/503/504 — what a sleeping
 * Render instance or a dropped pooled DB connection looks like from the browser.
 * Writes are never retried: a POST that reached the server must not run twice.
 */
async function fetchWithRetry(url: string, options: RequestInit): Promise<Response> {
  const idempotent = (options.method ?? "GET") === "GET";
  try {
    const response = await fetch(url, options);
    if (idempotent && [502, 503, 504].includes(response.status)) {
      await new Promise((r) => setTimeout(r, 1500));
      return await fetch(url, options);
    }
    return response;
  } catch (err) {
    if (!idempotent) throw err;
    await new Promise((r) => setTimeout(r, 1500));
    return fetch(url, options);
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  for (const [key, value] of Object.entries(await authHeader())) {
    headers.set(key, value);
  }

  const response = await fetchWithRetry(`${API_URL}${path}`, { ...options, headers });

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("Content-Type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    if (response.status === 429) {
      // A request limit (see the backend's throttling). Say so once, in the
      // backend's own words, wherever it happened.
      const detail = (payload as { detail?: string } | undefined)?.detail;
      toast.error(detail ?? "You're doing that too often. Please try again in a moment.", {
        id: "rate-limited",
      });
    }
    throw new ApiError(response.status, payload);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path, { method: "GET" }),
  post: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};

/**
 * For non-JSON downloads (e.g. the budget CSV export). A plain `<a href>`
 * can't carry the Authorization header, so callers fetch the file as a Blob
 * here and trigger the browser download themselves.
 */
export async function apiFetchBlob(path: string): Promise<Blob> {
  const headers = new Headers(await authHeader());
  const response = await fetch(`${API_URL}${path}`, { headers });
  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }
  return response.blob();
}
