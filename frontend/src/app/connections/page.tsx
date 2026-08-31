"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import {
  acceptConnection,
  avatarTint,
  blockConnection,
  cancelConnection,
  Connection,
  declineConnection,
  initials,
  listConnections,
} from "@/lib/buddies";
import { FormError } from "@/components/ui";

type Tab = "received" | "sent";

export default function ConnectionsPage() {
  const [tab, setTab] = useState<Tab>("received");
  const [received, setReceived] = useState<Connection[]>([]);
  const [sent, setSent] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);
      return Promise.all([
        listConnections({ direction: "incoming", status: "pending" }),
        listConnections({ direction: "outgoing", status: "pending" }),
      ]);
    };

    run()
      .then(([receivedRows, sentRows]) => {
        if (cancelled) return;
        setReceived(receivedRows);
        setSent(sentRows);
      })
      .catch(() => !cancelled && setError("Couldn't load your requests."))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, []);

  async function answer(
    connection: Connection,
    action: (id: number) => Promise<Connection>,
    successMessage: string,
  ) {
    setBusy(connection.id);
    try {
      await action(connection.id);
      setReceived((current) => current.filter((r) => r.id !== connection.id));
      toast.success(successMessage);
    } catch {
      toast.error("That didn't go through. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function cancel(connection: Connection) {
    setBusy(connection.id);
    try {
      await cancelConnection(connection.id);
      setSent((current) => current.filter((r) => r.id !== connection.id));
      toast.success("Request canceled");
    } catch {
      toast.error("Couldn't cancel that request. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-7">
      <h1 className="text-4xl leading-none tracking-tight">Requests</h1>
      <p className="mt-1.5 text-sm text-text-subtle">
        Buddy requests you&apos;ve received and ones still waiting on a reply.
      </p>

      <div
        role="tablist"
        aria-label="Requests"
        className="mt-5 inline-flex rounded-full bg-[#efece4] p-1"
      >
        {(
          [
            ["received", `Received${received.length ? ` (${received.length})` : ""}`],
            ["sent", `Sent (Pending)${sent.length ? ` (${sent.length})` : ""}`],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`rounded-full px-4 py-1.5 text-sm transition ${
              tab === value
                ? "bg-white font-bold text-brand-teal shadow-sm"
                : "text-text-subtle hover:text-brand-teal"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-4">
          <FormError message={error} />
        </div>
      )}

      {loading ? (
        <p aria-busy="true" className="mt-6 text-sm text-text-subtle">
          Loading…
        </p>
      ) : tab === "received" ? (
        <ReceivedList
          requests={received}
          busy={busy}
          onAccept={(c) => answer(c, acceptConnection, `You're now connected with ${c.other?.display_name ?? "them"}`)}
          onDecline={(c) => answer(c, declineConnection, "Request declined")}
          onBlock={(c) => answer(c, blockConnection, "Traveller blocked")}
        />
      ) : (
        <SentList requests={sent} busy={busy} onCancel={cancel} />
      )}
    </main>
  );
}

function ReceivedList({
  requests,
  busy,
  onAccept,
  onDecline,
  onBlock,
}: {
  requests: Connection[];
  busy: number | null;
  onAccept: (c: Connection) => void;
  onDecline: (c: Connection) => void;
  onBlock: (c: Connection) => void;
}) {
  if (requests.length === 0) {
    return (
      <div className="mt-8 rounded-xl border border-dashed border-line-input p-8 text-center">
        <p className="font-medium text-brand-teal">No requests waiting on you.</p>
        <p className="mt-1 text-sm text-text-subtle">
          Requests other travellers send you will show up here.
        </p>
      </div>
    );
  }

  return (
    <ul className="mt-5 space-y-3">
      {requests.map((request) => (
        <li
          key={request.id}
          className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4"
        >
          <span
            aria-hidden="true"
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-bold ${avatarTint(
              request.other?.supabase_user_id ?? String(request.id),
            )}`}
          >
            {initials(request.other?.display_name ?? "?")}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-serif text-base text-brand-teal">
              {request.other?.display_name ?? "A traveller"}
            </p>
            <p className="truncate text-xs text-text-subtle">
              {request.other?.area_label || "Area not set"}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy === request.id}
                onClick={() => onAccept(request)}
                className="rounded-full bg-brand-teal px-3.5 py-1.5 text-xs font-bold text-background transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Accept
              </button>
              <button
                type="button"
                disabled={busy === request.id}
                onClick={() => onDecline(request)}
                className="rounded-full border border-[#d5d9d0] px-3.5 py-1.5 text-xs font-semibold text-brand-teal transition hover:border-brand-teal disabled:cursor-not-allowed disabled:opacity-60"
              >
                Decline
              </button>
              <button
                type="button"
                disabled={busy === request.id}
                onClick={() => onBlock(request)}
                className="rounded-full px-3.5 py-1.5 text-xs font-medium text-brand-coral-ink transition hover:bg-brand-coral-tint disabled:cursor-not-allowed disabled:opacity-60"
              >
                Block
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function SentList({
  requests,
  busy,
  onCancel,
}: {
  requests: Connection[];
  busy: number | null;
  onCancel: (c: Connection) => void;
}) {
  if (requests.length === 0) {
    return (
      <div className="mt-8 rounded-xl border border-dashed border-line-input p-8 text-center">
        <p className="font-medium text-brand-teal">No pending requests.</p>
        <p className="mt-1 text-sm text-text-subtle">
          Requests you send from{" "}
          <Link href="/buddies" className="font-semibold underline">
            Buddies
          </Link>{" "}
          will show up here until they&apos;re answered.
        </p>
      </div>
    );
  }

  return (
    <ul className="mt-5 space-y-3">
      {requests.map((request) => (
        <li
          key={request.id}
          className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4"
        >
          <span
            aria-hidden="true"
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-bold ${avatarTint(
              request.other?.supabase_user_id ?? String(request.id),
            )}`}
          >
            {initials(request.other?.display_name ?? "?")}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-serif text-base text-brand-teal">
              {request.other?.display_name ?? "A traveller"}
            </p>
            <p className="truncate text-xs text-text-subtle">
              {request.other?.area_label || "Area not set"} · Waiting for a reply
            </p>
          </div>
          <button
            type="button"
            disabled={busy === request.id}
            onClick={() => onCancel(request)}
            className="shrink-0 rounded-full border border-[#d5d9d0] px-3.5 py-1.5 text-xs font-semibold text-brand-coral-ink transition hover:border-brand-coral-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel request
          </button>
        </li>
      ))}
    </ul>
  );
}
