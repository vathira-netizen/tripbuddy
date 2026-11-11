"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ApiError } from "@/lib/api";
import { blockTraveller, initials, monogramAccent, type Connection } from "@/lib/buddies";
import {
  formatMessageTime,
  listMessages,
  markConversationRead,
  MAX_BODY_LENGTH,
  type Message,
  sendMessage,
  subscribeToMessages,
} from "@/lib/messages";
import ReportUserDialog from "@/components/ReportUserDialog";

/** Lucide `send`, inlined — matches the other icons already inlined across the redesign. */
function Send({ className = "" }: { className?: string }) {
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
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [showReport, setShowReport] = useState(false);

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
  const accent = monogramAccent(other?.supabase_user_id ?? String(connection.id));

  return (
    <section className="flex h-[70vh] flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      <header className="flex items-center gap-2.5 border-b border-line px-[18px] py-3.5">
        <span
          aria-hidden="true"
          className={`grid h-[34px] w-[34px] shrink-0 place-items-center overflow-hidden rounded-full text-xs font-bold ${
            accent === "teal" ? "bg-brand-teal text-background" : "bg-brand-coral text-white"
          }`}
        >
          {other?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- user-supplied external URL
            <img src={other.avatar_url} alt="" className="h-full w-full object-cover" />
          ) : (
            initials(other?.display_name ?? "?")
          )}
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-foreground">
            {other?.display_name ?? "Traveller"}
          </h2>
          <p className="truncate text-xs text-text-subtle">
            {other?.area_label || "Area not set"}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span
            title={live ? "Receiving messages live" : "Reconnecting…"}
            className="flex items-center gap-1.5 text-xs text-text-subtle"
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${live ? "bg-brand-teal" : "bg-line-input"}`}
            />
            {live ? "Live" : "Offline"}
          </span>

          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Conversation options"
              aria-expanded={menuOpen}
              className="grid h-7 w-7 place-items-center rounded-full text-text-subtle hover:bg-surface-alt hover:text-brand-teal"
            >
              ⋯
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-9 z-20 w-40 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setShowReport(true);
                    }}
                    className="block w-full px-3.5 py-2 text-left text-xs font-semibold text-text-subtle hover:bg-surface-alt hover:text-brand-teal"
                  >
                    Report {other?.display_name ?? "traveller"}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setMenuOpen(false);
                      if (!other) return;
                      if (
                        !window.confirm(
                          `Block ${other.display_name}? You won't see each other again.`,
                        )
                      ) {
                        return;
                      }
                      try {
                        await blockTraveller(other.supabase_user_id);
                        toast.success(`Blocked ${other.display_name}`);
                      } catch {
                        toast.error("Couldn't block this traveller. Try again.");
                      }
                    }}
                    className="block w-full px-3.5 py-2 text-left text-xs font-semibold text-brand-coral-ink hover:bg-brand-coral-tint"
                  >
                    Block {other?.display_name ?? "traveller"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {showReport && other && (
        <ReportUserDialog
          supabaseUserId={other.supabase_user_id}
          displayName={other.display_name}
          onClose={() => setShowReport(false)}
        />
      )}

      <div className="flex-1 space-y-2 overflow-y-auto bg-background px-4 py-3">
        {loading && (
          <p aria-busy="true" className="text-sm text-text-subtle">
            Loading messages…
          </p>
        )}

        {!loading && messages.length === 0 && (
          <p className="py-8 text-center text-sm text-text-subtle">
            No messages yet. Say hello.
          </p>
        )}

        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        <div ref={bottomRef} />
      </div>

      <form onSubmit={send} className="border-t border-line bg-surface px-4 py-3">
        {error && (
          <p role="alert" className="mb-2 text-xs text-brand-coral-ink">
            {error}
          </p>
        )}
        <div className="flex items-end gap-2">
          <label htmlFor="message-body" className="sr-only">
            Message
          </label>
          <textarea
            id="message-body"
            rows={1}
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
            className="flex-1 resize-none overflow-hidden rounded-full border border-line-input bg-white px-4 py-2.5 text-sm shadow-sm outline-none focus:border-brand-coral focus:ring-2 focus:ring-brand-coral/30"
          />
          <button
            type="submit"
            disabled={sending || draft.trim().length === 0}
            aria-label="Send"
            className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full bg-brand-coral text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Send className="h-[17px] w-[17px]" />
          </button>
        </div>
        {remaining < 200 && (
          <p className="mt-1 text-right text-xs text-text-subtle">
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
        className={`max-w-[75%] px-3.5 py-2 text-sm ${
          mine
            ? "rounded-2xl rounded-br-md bg-brand-teal text-background"
            : "rounded-2xl rounded-bl-md border border-line bg-white text-foreground"
        }`}
      >
        {/* Rendered as a text child: React escapes it. Never dangerouslySetInnerHTML. */}
        <p className="whitespace-pre-wrap break-words">{message.body}</p>
        <time
          dateTime={message.created_at}
          className={`mt-0.5 block text-[10px] ${
            mine ? "text-background/70" : "text-text-subtle"
          }`}
        >
          {formatMessageTime(message.created_at)}
        </time>
      </div>
    </div>
  );
}
