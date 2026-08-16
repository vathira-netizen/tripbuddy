"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/lib/api";
import { avatarTint, initials, type Connection } from "@/lib/buddies";
import {
  formatMessageTime,
  listMessages,
  markConversationRead,
  MAX_BODY_LENGTH,
  type Message,
  sendMessage,
  subscribeToMessages,
} from "@/lib/messages";

/**
 * One conversation: history from the API, new messages over Realtime.
 *
 * Message bodies are rendered as text children, never as HTML — React escapes
 * them, which is the XSS defence for a field any traveller can write into.
 */
export function MessageThread({ connection }: { connection: Connection }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  /**
   * Insert or replace by id.
   *
   * The same message can arrive twice: once as the POST response and once as
   * the Realtime echo of the row it created. The API version wins — Realtime
   * sends raw columns and cannot say whether the row is the reader's own.
   */
  const upsert = useCallback((incoming: Message) => {
    setMessages((current) => {
      const index = current.findIndex((m) => m.id === incoming.id);
      if (index === -1) {
        return [...current, incoming].sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime() ||
            a.id - b.id,
        );
      }
      const existing = current[index];
      // Keep whichever knows the sender: that one came from the API.
      if (existing.sender_name && !incoming.sender_name) return current;
      const next = [...current];
      next[index] = incoming;
      return next;
    });
  }, []);

  // History + mark the thread read on open.
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const page = await listMessages(connection.id);
        if (cancelled) return;
        setMessages(page.results);
        await markConversationRead(connection.id);
      } catch {
        if (!cancelled) setError("Could not load this conversation.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [connection.id]);

  // Realtime: append inserts as they land.
  useEffect(() => {
    let cancelled = false;

    const unsubscribe = subscribeToMessages(
      connection.id,
      (message) => upsert(message),
      (status) => {
        const subscribed = status === "SUBSCRIBED";
        setLive(subscribed);
        if (!subscribed) return;

        // SUBSCRIBED is acknowledged slightly before the server finishes
        // wiring the filter, so a message sent in that window never arrives.
        // Re-read history once the channel is genuinely live and merge: the
        // upsert dedupes by id, so anything already shown is untouched and
        // anything missed appears. Also covers a reconnect after a drop.
        void listMessages(connection.id)
          .then((page) => {
            if (!cancelled) page.results.forEach(upsert);
          })
          .catch(() => {
            /* the thread is still usable from what is already loaded */
          });
      },
    );

    return () => {
      cancelled = true;
      setLive(false);
      unsubscribe();
    };
  }, [connection.id, upsert]);

  // Keep the newest message in view.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    setError(null);
    try {
      const message = await sendMessage(connection.id, body);
      setDraft("");
      upsert(message);
    } catch (err) {
      if (err instanceof ApiError) {
        const data = err.data as { body?: string[]; detail?: string } | undefined;
        setError(data?.body?.[0] ?? data?.detail ?? "Message not sent.");
      } else {
        setError("Message not sent.");
      }
    } finally {
      setSending(false);
    }
  };

  const other = connection.other;
  const remaining = MAX_BODY_LENGTH - draft.trim().length;

  return (
    <section className="flex h-[70vh] flex-col rounded-xl border border-black/10 dark:border-white/15">
      <header className="flex items-center gap-3 border-b border-black/10 px-4 py-3 dark:border-white/15">
        <span
          aria-hidden="true"
          className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold ${avatarTint(
            other?.supabase_user_id ?? String(connection.id),
          )}`}
        >
          {initials(other?.display_name ?? "?")}
        </span>
        <div className="min-w-0">
          <h2 className="truncate font-semibold">
            {other?.display_name ?? "Traveller"}
          </h2>
          <p className="truncate text-xs text-black/55 dark:text-white/55">
            {other?.area_label || "Area not set"}
          </p>
        </div>
        <span
          title={live ? "Receiving messages live" : "Reconnecting…"}
          className={`ml-auto h-2 w-2 shrink-0 rounded-full ${
            live ? "bg-emerald-500" : "bg-black/25 dark:bg-white/30"
          }`}
        >
          <span className="sr-only">{live ? "Live" : "Not live"}</span>
        </span>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {loading && (
          <p aria-busy="true" className="text-sm text-black/55 dark:text-white/55">
            Loading messages…
          </p>
        )}

        {!loading && messages.length === 0 && (
          <p className="py-8 text-center text-sm text-black/55 dark:text-white/55">
            No messages yet. Say hello.
          </p>
        )}

        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={send}
        className="border-t border-black/10 px-4 py-3 dark:border-white/15"
      >
        {error && (
          <p role="alert" className="mb-2 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex items-end gap-2">
          <label htmlFor="message-body" className="sr-only">
            Message
          </label>
          <textarea
            id="message-body"
            rows={2}
            value={draft}
            maxLength={MAX_BODY_LENGTH}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter is a newline.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(e);
              }
            }}
            placeholder="Write a message…"
            className="flex-1 resize-none rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-white/20"
          />
          <button
            type="submit"
            disabled={sending || draft.trim().length === 0}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
        {remaining < 200 && (
          <p className="mt-1 text-right text-xs text-black/50 dark:text-white/50">
            {remaining} characters left
          </p>
        )}
      </form>
    </section>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const mine = message.is_mine;
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
          mine
            ? "bg-indigo-600 text-white"
            : "bg-black/5 text-black dark:bg-white/10 dark:text-white"
        }`}
      >
        {/* Rendered as a text child: React escapes it. Never dangerouslySetInnerHTML. */}
        <p className="whitespace-pre-wrap break-words">{message.body}</p>
        <time
          dateTime={message.created_at}
          className={`mt-0.5 block text-[10px] ${
            mine ? "text-white/70" : "text-black/45 dark:text-white/45"
          }`}
        >
          {formatMessageTime(message.created_at)}
        </time>
      </div>
    </div>
  );
}
