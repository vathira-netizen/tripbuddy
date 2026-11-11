"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";

import {
  chatErrorMessage,
  getChat,
  sendChatMessage,
  type ChatMessage,
  type ChatPlace,
  type Conversation,
} from "@/lib/chats";
import { formatINR, type Destination } from "@/lib/discover";
import { ChatComposer, ChatMessageView } from "@/components/ChatMessageView";
import CreateTripFromChat from "@/components/CreateTripFromChat";
import { FormError } from "@/components/ui";

// Leaflet touches window on import, so the map is client-only.
const DestinationMap = dynamic(() => import("@/components/DestinationMap"), { ssr: false });

/** A chat: conversation on the left, the places it mentions on a map on the
 * right, and the trip details it has picked up as chips in the header. */
export default function ChatPage() {
  const params = useParams<{ id: string }>();
  const chatId = Number(params.id);

  const [chat, setChat] = useState<Conversation | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState<ChatPlace | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getChat(chatId)
      .then(setChat)
      .catch(() => setError("Couldn't load this chat."));
  }, [chatId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat?.messages.length, pending]);

  // Every catalogue place mentioned anywhere in the chat, first mention first.
  const places = useMemo(() => {
    const seen = new Map<string, ChatPlace>();
    chat?.messages.forEach((m) => m.data.places?.forEach((p) => seen.set(p.slug, p)));
    return [...seen.values()];
  }, [chat]);

  const latestPlan = useMemo(
    () => [...(chat?.messages ?? [])].reverse().find((m) => m.data.plan)?.data.plan,
    [chat],
  );

  async function send(text: string) {
    setPending(text);
    setError(null);
    try {
      setChat(await sendChatMessage(chatId, text));
    } catch (err) {
      setError(chatErrorMessage(err));
    } finally {
      setPending(null);
    }
  }

  if (!chat) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        {error ? <FormError message={error} /> : <p className="text-sm text-text-subtle">Loading chat…</p>}
      </main>
    );
  }

  const ctx = chat.context;
  const chips = [
    ctx.destination,
    ctx.days && `${ctx.days} day${ctx.days === 1 ? "" : "s"}`,
    ctx.travellers && `${ctx.travellers} traveller${ctx.travellers === 1 ? "" : "s"}`,
    ctx.budget != null && formatINR(ctx.budget),
  ].filter(Boolean) as string[];

  const pendingMessage: ChatMessage | null = pending
    ? { id: -1, role: "user", content: pending, data: {}, created_at: "" }
    : null;

  return (
    <main className="mx-auto grid max-w-7xl gap-4 px-4 py-4 lg:h-[calc(100vh-5rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <section className="flex min-h-0 flex-col rounded-[20px] border border-line bg-white">
        <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <Link href="/chat" className="text-sm text-text-subtle hover:text-brand-teal" aria-label="All chats">
            ←
          </Link>
          <h1 className="min-w-0 flex-1 truncate font-serif text-lg text-brand-teal">
            {chat.title || "New chat"}
          </h1>
          <CreateTripFromChat chat={chat} places={places} plan={latestPlan} />
          {chips.length > 0 && (
            <ul className="flex w-full flex-wrap gap-1.5" aria-label="Trip details so far">
              {chips.map((c) => (
                <li key={c} className="rounded-full bg-surface-alt px-2.5 py-1 text-xs font-semibold text-brand-teal">
                  {c}
                </li>
              ))}
            </ul>
          )}
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4" aria-live="polite">
          {chat.messages.map((m) => (
            <ChatMessageView key={m.id} message={m} onFollowUp={send} onPlaceFocus={setFocused} />
          ))}
          {pendingMessage && <ChatMessageView message={pendingMessage} />}
          {pending && <p className="text-sm text-text-subtle">Thinking…</p>}
          <div ref={bottom} />
        </div>

        <div className="space-y-2 border-t border-line p-3">
          <FormError message={error} />
          <ChatComposer onSend={send} busy={pending !== null} placeholder="Ask a follow-up…" />
          <p className="text-center text-[11px] text-text-subtle">
            AI answers can be wrong — check prices and timings before you book.
          </p>
        </div>
      </section>

      <section className="h-72 overflow-hidden rounded-[20px] border border-line lg:h-auto" aria-label="Map of places in this chat">
        <DestinationMap
          // ChatPlace carries every field the map reads (id, name, lat, lng, avg_daily_budget).
          destinations={places as unknown as Destination[]}
          selected={focused as unknown as Destination | null}
          onSelect={(d) => setFocused(d as unknown as ChatPlace)}
        />
      </section>
    </main>
  );
}
