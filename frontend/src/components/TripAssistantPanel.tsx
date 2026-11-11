"use client";

import { FormEvent, useState } from "react";

import { ApiError } from "@/lib/api";
import { askAssistant, AssistantReply } from "@/lib/trips";
import { Button, FormError, Input } from "@/components/ui";
import PlanSummary from "@/components/PlanSummary";

interface Turn {
  question: string;
  reply: AssistantReply;
}

/** Ask questions about this trip's budget and the destination catalogue.
 * Any plan the assistant suggests carries the server's budget check. */
export default function TripAssistantPanel({ tripId }: { tripId: number }) {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    try {
      const reply = await askAssistant(tripId, q);
      setTurns((t) => [...t, { question: q, reply }]);
      setQuestion("");
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 503
          ? "The assistant isn't configured on the server yet."
          : "The assistant is unavailable right now. Try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section
      aria-labelledby="assistant-heading"
      className="rounded-[20px] border border-line bg-white p-5"
    >
      <h2 id="assistant-heading" className="text-lg font-bold text-brand-teal">
        Trip assistant
      </h2>
      <p className="mt-1 text-sm text-text-subtle">
        Ask about your budget or where to go, e.g. “Can I do 3 days in Hampi
        with ₹5,000?”
      </p>

      <ul className="mt-4 space-y-4" aria-live="polite">
        {turns.map((t, i) => (
          <li key={i} className="space-y-2">
            <p className="text-sm font-semibold">{t.question}</p>
            <p className="whitespace-pre-line text-sm">{t.reply.answer}</p>
            {t.reply.plan && <PlanSummary plan={t.reply.plan} />}
          </li>
        ))}
      </ul>

      <form onSubmit={onSubmit} className="mt-4 flex items-end gap-2">
        <div className="flex-1">
          <Input
            label="Your question"
            value={question}
            maxLength={500}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </div>
        <Button type="submit" loading={loading} className="!w-auto">
          Ask
        </Button>
      </form>
      <FormError message={error} />
    </section>
  );
}
