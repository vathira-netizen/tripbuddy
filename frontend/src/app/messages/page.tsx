"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { avatarTint, type Connection, initials } from "@/lib/buddies";
import {
  getUnreadSummary,
  listConversations,
  type UnreadSummary,
} from "@/lib/messages";
import { MessageThread } from "@/components/MessageThread";

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
        <h1 className="text-3xl font-extrabold tracking-tight">Messages</h1>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          Conversations with travellers you have connected with.
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      {loading && (
        <p aria-busy="true" className="text-sm text-black/60 dark:text-white/60">
          Loading…
        </p>
      )}

      {!loading && conversations.length === 0 && !error && (
        <div className="card p-8 text-center">
          <p className="text-lg font-bold">No conversations yet.</p>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Messaging opens once a buddy request is accepted —{" "}
            <Link href="/buddies" className="font-semibold text-indigo-600 underline">
              find travel buddies
            </Link>
            .
          </p>
        </div>
      )}

      {!loading && conversations.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <nav aria-label="Conversations" className="card h-fit p-2">
            <ul className="space-y-1">
              {conversations.map((conversation) => {
                const unread = summary?.unread_by_connection[String(conversation.id)] ?? 0;
                const active = conversation.id === selected?.id;
                return (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      onClick={() => select(conversation)}
                      aria-current={active ? "true" : undefined}
                      className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition ${
                        active
                          ? "bg-indigo-50 ring-1 ring-indigo-200"
                          : "hover:bg-black/5"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarTint(
                          conversation.other?.supabase_user_id ?? String(conversation.id),
                        )}`}
                      >
                        {initials(conversation.other?.display_name ?? "?")}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {conversation.other?.display_name ?? "Traveller"}
                        </span>
                        <span className="block truncate text-xs text-black/55 dark:text-white/55">
                          {conversation.other?.area_label || "Area not set"}
                        </span>
                      </span>
                      {unread > 0 && (
                        <span className="shrink-0 rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white">
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
            <div className="card flex items-center justify-center p-12 text-center">
              <p className="text-sm text-black/60">
                💬 Pick a conversation to start reading.
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
