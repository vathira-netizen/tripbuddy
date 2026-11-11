"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { initials, monogramAccent, type Connection } from "@/lib/buddies";
import {
  getUnreadSummary,
  listConversations,
  type UnreadSummary,
} from "@/lib/messages";
import { MessageThread } from "@/components/MessageThread";
import { FormError } from "@/components/ui";

/** Lucide `message-circle`, inlined — matches the other icons already inlined across the redesign. */
function MessageCircle({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function monogramClass(accent: "teal" | "coral"): string {
  return accent === "teal"
    ? "bg-brand-teal text-background"
    : "bg-brand-coral text-white";
}

function MessagesInner() {
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get("c");

  const [conversations, setConversations] = useState<Connection[]>([]);
  const [summary, setSummary] = useState<UnreadSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      try {
        const [rows, unread] = await Promise.all([
          listConversations(),
          getUnreadSummary(),
        ]);
        if (cancelled) return;
        setConversations(rows);
        setSummary(unread);
      } catch {
        if (!cancelled) setError("Could not load your conversations.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = useMemo(
    () => conversations.find((c) => String(c.id) === selectedId) ?? null,
    [conversations, selectedId],
  );

  const select = (connection: Connection) => {
    // Opening a thread marks it read, so drop its badge immediately.
    setSummary((current) => {
      if (!current) return current;
      const { [String(connection.id)]: cleared = 0, ...rest } =
        current.unread_by_connection;
      return {
        ...current,
        unread_messages: Math.max(0, current.unread_messages - cleared),
        unread_by_connection: rest,
      };
    });
    router.replace(`/messages?c=${connection.id}`, { scroll: false });
  };

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 p-6">
      <header className="mb-6">
        <h1 className="text-4xl leading-none tracking-tight">Messages</h1>
        <p className="mt-1.5 text-sm text-text-subtle">
          Conversations with travellers you have connected with.
        </p>
      </header>

      {error && <FormError message={error} />}

      {loading && (
        <p aria-busy="true" className="text-sm text-text-subtle">
          Loading…
        </p>
      )}

      {!loading && conversations.length === 0 && !error && (
        <div className="rounded-2xl border border-line bg-surface p-8 text-center">
          <p className="font-serif text-xl text-brand-teal">No conversations yet.</p>
          <p className="mt-1 text-sm text-text-subtle">
            Messaging opens once a buddy request is accepted —{" "}
            <Link href="/buddies" className="font-semibold text-brand-coral-ink underline">
              find travel buddies
            </Link>
            .
          </p>
        </div>
      )}

      {!loading && conversations.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <nav
            aria-label="Conversations"
            className="h-fit rounded-2xl border border-line bg-surface p-2"
          >
            <ul className="space-y-1">
              {conversations.map((conversation) => {
                const unread = summary?.unread_by_connection[String(conversation.id)] ?? 0;
                const active = conversation.id === selected?.id;
                const accent = monogramAccent(
                  conversation.other?.supabase_user_id ?? String(conversation.id),
                );
                return (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      onClick={() => select(conversation)}
                      aria-current={active ? "true" : undefined}
                      className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition ${
                        active ? "bg-surface-alt" : "hover:bg-surface-alt/60"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full text-xs font-bold ${monogramClass(
                          accent,
                        )}`}
                      >
                        {conversation.other?.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element -- user-supplied external URL
                          <img
                            src={conversation.other.avatar_url}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          initials(conversation.other?.display_name ?? "?")
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-foreground">
                          {conversation.other?.display_name ?? "Traveller"}
                        </span>
                        <span className="block truncate text-xs text-text-subtle">
                          {conversation.other?.area_label || "Area not set"}
                        </span>
                      </span>
                      {unread > 0 && (
                        <span className="shrink-0 rounded-full bg-brand-coral px-2 py-0.5 text-xs font-bold text-white">
                          {unread}
                          <span className="sr-only"> unread messages</span>
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {selected ? (
            <MessageThread key={selected.id} connection={selected} />
          ) : (
            <div className="flex items-center justify-center rounded-2xl border border-line bg-surface p-12 text-center">
              <p className="flex items-center gap-2 text-sm text-text-subtle">
                <MessageCircle className="h-4 w-4" />
                Pick a conversation to start reading.
              </p>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm">Loading…</p>}>
      <MessagesInner />
    </Suspense>
  );
}
