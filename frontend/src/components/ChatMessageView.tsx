"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";

import type { ChatMessage, ChatPlace } from "@/lib/chats";
import { formatINR } from "@/lib/discover";
import PlanSummary from "@/components/PlanSummary";

/** One turn of the chat. Assistant turns render markdown, the budget-checked
 * plan, cards for the catalogue places mentioned, and a follow-up chip. */
export function ChatMessageView({
  message,
  onFollowUp,
  onPlaceFocus,
}: {
  message: ChatMessage;
  onFollowUp?: (text: string) => void;
  onPlaceFocus?: (place: ChatPlace) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-line rounded-2xl rounded-br-sm bg-brand-teal px-4 py-2.5 text-sm text-background">
          {message.content}
        </p>
      </div>
    );
  }

  const { places = [], plan, follow_up } = message.data;
  return (
    <div className="space-y-3">
      <div className="chat-md text-foreground">
        {/* react-markdown escapes raw HTML by default, so model output can't inject markup. */}
        <ReactMarkdown>{message.content}</ReactMarkdown>
      </div>

      {plan && <PlanSummary plan={plan} />}

      {places.length > 0 && (
        <ul className="flex gap-3 overflow-x-auto pb-1" aria-label="Places mentioned">
          {places.map((p) => (
            <li key={p.slug} className="w-40 shrink-0">
              <Link
                href={`/discover/${p.slug}`}
                onMouseEnter={() => onPlaceFocus?.(p)}
                onFocus={() => onPlaceFocus?.(p)}
                className="block overflow-hidden rounded-xl border border-line bg-white transition hover:shadow-md"
              >
                {p.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- catalogue placeholder URLs
                  <img src={p.image_url} alt="" className="h-24 w-full object-cover" />
                ) : (
                  <div className="h-24 bg-surface-alt" />
                )}
                <div className="p-2">
                  <p className="truncate text-sm font-semibold">{p.name}</p>
                  <p className="truncate text-xs text-text-subtle">
                    {p.state} · {formatINR(p.avg_daily_budget)}/day
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {follow_up && onFollowUp && (
        <button
          type="button"
          onClick={() => onFollowUp(follow_up)}
          className="rounded-full border border-brand-teal/30 px-3 py-1.5 text-left text-sm text-brand-teal hover:bg-surface-alt"
        >
          {follow_up}
        </button>
      )}
    </div>
  );
}

/** The chat input. Enter sends; disabled while a reply is pending. */
export function ChatComposer({
  onSend,
  busy,
  placeholder = "Ask about a trip, a budget or where to go…",
}: {
  onSend: (text: string) => void;
  busy: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    onSend(value);
    setText("");
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2 rounded-full border border-line-input bg-white p-1.5 pl-4 shadow-sm">
      <label htmlFor="chat-input" className="sr-only">
        Message the trip assistant
      </label>
      <input
        id="chat-input"
        value={text}
        maxLength={2000}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        autoComplete="off"
      />
      <button
        type="submit"
        disabled={busy || !text.trim()}
        className="rounded-full bg-brand-teal px-4 py-2 text-sm font-bold text-background disabled:opacity-50"
      >
        {busy ? "Thinking…" : "Send"}
      </button>
    </form>
  );
}
