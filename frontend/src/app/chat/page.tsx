"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { chatErrorMessage, listChats, startChat, type ConversationSummary } from "@/lib/chats";
import { ChatComposer } from "@/components/ChatMessageView";
import { FormError } from "@/components/ui";

const SUGGESTIONS = [
  "Weekend trip under ₹5,000 from Bengaluru",
  "Where can 2 students go for 4 days in December on ₹12,000?",
  "Plan 3 days in Hampi on a backpacker budget",
  "Cheapest hill station to visit in May",
];

/** New-chat screen plus the list of past chats. */
export default function ChatHomePage() {
  const router = useRouter();
  const [chats, setChats] = useState<ConversationSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listChats().then(setChats).catch(() => {});
  }, []);

  async function send(text: string) {
    setBusy(true);
    setError(null);
    try {
      const chat = await startChat(text);
      router.push(`/chat/${chat.id}`);
    } catch (err) {
      setError(chatErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <section className="space-y-4 text-center">
        <h1 className="font-serif text-3xl font-bold text-brand-teal">Where to, on your budget?</h1>
        <p className="text-sm text-text-subtle">
          Ask the trip assistant. It answers from our destination catalogue and checks every plan
          against your budget.
        </p>
        <ChatComposer onSend={send} busy={busy} />
        <FormError message={error} />
        <ul className="flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((s) => (
            <li key={s}>
              <button
                type="button"
                disabled={busy}
                onClick={() => send(s)}
                className="rounded-full border border-line bg-white px-3 py-1.5 text-sm hover:bg-surface-alt disabled:opacity-50"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      </section>

      {chats.length > 0 && (
        <section aria-labelledby="past-chats" className="space-y-2">
          <h2 id="past-chats" className="text-xs font-bold uppercase tracking-wide text-brand-teal">
            Your chats
          </h2>
          <ul className="divide-y divide-line rounded-[16px] border border-line bg-white">
            {chats.map((c) => (
              <li key={c.id}>
                <Link href={`/chat/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {c.title || "Untitled chat"}
                  </span>
                  {c.trip_title && (
                    <span className="shrink-0 text-xs text-text-subtle">Trip: {c.trip_title}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
