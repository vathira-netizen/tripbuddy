"use client";

import { useEffect, useState } from "react";

import {
  acceptConnection,
  avatarTint,
  blockConnection,
  Connection,
  declineConnection,
  initials,
  listConnections,
} from "@/lib/buddies";

/**
 * Pending buddy requests addressed to the current user.
 *
 * Answering one removes it from the list optimistically — the row is gone
 * either way, and re-fetching just to watch it disappear reads as a stall.
 */
export function IncomingRequests({ onAnswered }: { onAnswered?: () => void }) {
  const [requests, setRequests] = useState<Connection[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      try {
        const rows = await listConnections({
          direction: "incoming",
          status: "pending",
        });
        if (!cancelled) setRequests(rows);
      } catch {
        if (!cancelled) setError("Could not load your requests.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  const answer = async (
    connection: Connection,
    action: (id: number) => Promise<Connection>,
  ) => {
    setBusy(connection.id);
    setError(null);
    try {
      await action(connection.id);
      setRequests((current) => current.filter((r) => r.id !== connection.id));
      onAnswered?.();
    } catch {
      setError("That did not go through. Try again.");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <section aria-busy="true" className="card p-4">
        <h2 className="">Requests</h2>
        <p className="mt-2 text-sm text-black/60 dark:text-white/60">Loading…</p>
      </section>
    );
  }

  if (requests.length === 0) {
    return (
      <section className="card p-4">
        <h2 className="">Requests</h2>
        <p className="mt-2 text-sm text-black/60 dark:text-white/60">
          No pending requests.
        </p>
      </section>
    );
  }

  return (
    <section className="card p-4">
      <h2 className="">
        Requests{" "}
        <span className="ml-1 rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white">
          {requests.length}
        </span>
      </h2>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <ul className="mt-3 space-y-3">
        {requests.map((request) => (
          <li key={request.id} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarTint(
                request.other?.supabase_user_id ?? String(request.id),
              )}`}
            >
              {initials(request.other?.display_name ?? "?")}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {request.other?.display_name ?? "A traveller"}
              </p>
              <p className="truncate text-xs text-black/60 dark:text-white/60">
                {request.other?.area_label || "Area not set"}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy === request.id}
                  onClick={() => answer(request, acceptConnection)}
                  className="rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
                >
                  Accept
                </button>
                <button
                  type="button"
                  disabled={busy === request.id}
                  onClick={() => answer(request, declineConnection)}
                  className="rounded-lg border border-line-input px-3 py-1.5 text-xs font-semibold transition hover:border-black/30 disabled:opacity-60 dark:border-white/20 dark:hover:border-white/40"
                >
                  Decline
                </button>
                <button
                  type="button"
                  disabled={busy === request.id}
                  onClick={() => answer(request, blockConnection)}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  Block
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
