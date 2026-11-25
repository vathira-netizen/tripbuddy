"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ApiError } from "@/lib/api";
import { needsPhoneVerification } from "@/lib/phone";
import {
  formatMessageTime,
  MAX_BODY_LENGTH,
  type Message,
  notifyUnreadChanged,
} from "@/lib/messages";
import { EmojiPicker } from "@/components/EmojiPicker";
import { toastPhoneRequired } from "@/components/PhonePrompt";

/** Where a thread's messages come from — a 1:1 connection or a trip group. */
export interface ChatSource {
  /** Newest page, oldest to newest. */
  list: () => Promise<Message[]>;
  send: (body: string) => Promise<Message>;
  markRead: () => Promise<unknown>;
  /** "Clear chat" for this user only; resolves with the server's cut-off. */
  clear?: () => Promise<{ cleared_at: string }>;
  /** Optional instant delivery (DMs use Supabase Realtime); polling covers the rest. */
  subscribe?: (
    onInsert: (message: Message) => void,
    onStatus: (status: string) => void,
  ) => () => void;
}

// Polling is what makes read receipts and group messages live: Realtime only
// delivers inserts (and only for DMs), so a "seen" tick or a groupmate's
// message needs a refetch. Cheap — one page, only while the tab is visible.
const POLL_MS = 4000;

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

/** Lucide `trash-2`, inlined. */
function Trash({ className = "" }: { className?: string }) {
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
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

/**
 * The shared chat UI: history, live updates, read receipts, emoji, composer.
 *
 * Message bodies are rendered as text children, never as HTML — React escapes
 * them, which is the XSS defence for a field any traveller can write into.
 * Remount (key) per conversation; `source` must be stable (useMemo).
 */
export function ChatPanel({
  source,
  group = false,
  avatar,
  title,
  subtitle,
  menu,
  composerExtra,
}: {
  source: ChatSource;
  group?: boolean;
  avatar: ReactNode;
  title: string;
  subtitle: string;
  menu?: ReactNode;
  composerExtra?: ReactNode;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [visible, setVisible] = useState(true);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const markedRef = useRef(0);
  // After "Clear chat", a poll already in flight may still return older
  // messages; anything at or before this cut-off is dropped, not re-shown.
  const clearedAtRef = useRef(0);

  /**
   * Insert or replace by id.
   *
   * The same message can arrive several ways (POST response, Realtime echo,
   * poll). Versions that know the sender (API) win over the bare Realtime row,
   * and a poll refreshes `read_at` / `seen_by` on messages already shown.
   */
  const upsert = useCallback((incoming: Message) => {
    if (new Date(incoming.created_at).getTime() <= clearedAtRef.current) return;
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
      if (existing.sender_name && !incoming.sender_name) return current;
      const next = [...current];
      next[index] = incoming;
      return next;
    });
  }, []);

  // History.
  useEffect(() => {
    let cancelled = false;
    source
      .list()
      .then((rows) => !cancelled && setMessages(rows))
      .catch(() => !cancelled && setError("Could not load this conversation."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [source]);

  // Realtime inserts (DMs).
  useEffect(() => {
    if (!source.subscribe) return;
    let cancelled = false;
    const unsubscribe = source.subscribe(upsert, (status) => {
      const subscribed = status === "SUBSCRIBED";
      setLive(subscribed);
      if (!subscribed) return;
      // SUBSCRIBED is acknowledged slightly before the filter is wired, so a
      // message sent in that window never arrives. Re-read once genuinely live.
      source
        .list()
        .then((rows) => !cancelled && rows.forEach(upsert))
        .catch(() => {});
    });
    return () => {
      cancelled = true;
      setLive(false);
      unsubscribe();
    };
  }, [source, upsert]);

  // Poll while the tab is visible (also the only live path for groups).
  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const tick = () =>
      source
        .list()
        .then((rows) => {
          if (cancelled) return;
          rows.forEach(upsert);
          if (!source.subscribe) setLive(true);
        })
        .catch(() => !cancelled && !source.subscribe && setLive(false));
    const timer = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [source, upsert, visible]);

  // Mark read whenever a newer incoming message is on screen — not just on
  // open, or messages arriving mid-conversation stay "unread" forever and the
  // navbar badge never clears.
  useEffect(() => {
    if (!visible) return;
    const newest = messages.reduce((n, m) => (!m.is_mine && m.id > n ? m.id : n), 0);
    if (newest <= markedRef.current) return;
    const previous = markedRef.current;
    markedRef.current = newest;
    source
      .markRead()
      .then(notifyUnreadChanged)
      .catch(() => {
        markedRef.current = previous; // retry on the next change
      });
  }, [messages, source, visible]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const send = async (event: React.FormEvent | React.KeyboardEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    setError(null);
    try {
      const message = await source.send(body);
      setDraft("");
      upsert(message);
    } catch (err) {
      if (needsPhoneVerification(err)) {
        // Old messages stay readable; sending needs a verified phone.
        setError("Verify your phone number to send messages.");
        toastPhoneRequired();
      } else if (err instanceof ApiError) {
        const data = err.data as { body?: string[]; detail?: string } | undefined;
        setError(data?.body?.[0] ?? data?.detail ?? "Message not sent.");
      } else {
        setError("Message not sent.");
      }
    } finally {
      setSending(false);
    }
  };

  const insertEmoji = (emoji: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? start;
    setDraft((draft.slice(0, start) + emoji + draft.slice(end)).slice(0, MAX_BODY_LENGTH));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  const clearChat = async () => {
    if (!source.clear) return;
    if (
      !window.confirm(
        "Clear this chat? Messages so far disappear for you only; everyone else keeps them.",
      )
    ) {
      return;
    }
    try {
      const { cleared_at } = await source.clear();
      clearedAtRef.current = new Date(cleared_at).getTime();
      setMessages([]);
      notifyUnreadChanged();
      toast.success("Chat cleared");
    } catch {
      toast.error("Couldn't clear this chat. Try again.");
    }
  };

  const remaining = MAX_BODY_LENGTH - draft.trim().length;

  return (
    <section className="flex h-[70vh] flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      <header className="flex items-center gap-2.5 border-b border-line px-[18px] py-3.5">
        {avatar}
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
          <p className="truncate text-xs text-text-subtle">{subtitle}</p>
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
          {source.clear && (
            <button
              type="button"
              onClick={clearChat}
              disabled={messages.length === 0}
              aria-label="Clear chat"
              title="Clear chat (for you only)"
              className="grid h-7 w-7 place-items-center rounded-full text-text-subtle hover:bg-surface-alt hover:text-brand-coral-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <Trash className="h-4 w-4" />
            </button>
          )}
          {menu}
        </div>
      </header>

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
          <MessageBubble key={message.id} message={message} group={group} />
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
          <EmojiPicker onPick={insertEmoji} />
          {composerExtra}
          <label htmlFor="message-body" className="sr-only">
            Message
          </label>
          <textarea
            ref={inputRef}
            id="message-body"
            rows={1}
            value={draft}
            maxLength={MAX_BODY_LENGTH}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter is a newline. Ignore Enter while an
              // IME composition (e.g. emoji/Japanese keyboards) is committing.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
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

/** "✓ Sent" until someone has read it, then "✓✓ Seen" (groups: "Seen by N"). */
function receipt(message: Message, group: boolean): { text: string; seen: boolean } {
  const n = message.seen_by ?? 0;
  const seen = group ? n > 0 : message.read_at !== null;
  return {
    seen,
    text: !seen ? "✓ Sent" : group ? `✓✓ Seen by ${n}` : "✓✓ Seen",
  };
}

function MessageBubble({ message, group }: { message: Message; group: boolean }) {
  const mine = message.is_mine;
  const r = mine ? receipt(message, group) : null;
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] px-3.5 py-2 text-sm ${
          mine
            ? "rounded-2xl rounded-br-md bg-brand-teal text-background"
            : "rounded-2xl rounded-bl-md border border-line bg-white text-foreground"
        }`}
      >
        {group && !mine && message.sender_name && (
          <p className="mb-0.5 text-[11px] font-bold text-brand-coral-ink">
            {message.sender_name}
          </p>
        )}
        {/* Rendered as a text child: React escapes it. Never dangerouslySetInnerHTML. */}
        <p className="whitespace-pre-wrap break-words">{message.body}</p>
        <p
          className={`mt-0.5 flex items-center justify-end gap-1.5 text-[10px] ${
            mine ? "text-background/70" : "text-text-subtle"
          }`}
        >
          <time dateTime={message.created_at}>{formatMessageTime(message.created_at)}</time>
          {r && (
            <span aria-label={r.seen ? "Seen" : "Sent"} className={r.seen ? "font-bold text-[#9fe3d6]" : ""}>
              {r.text}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
