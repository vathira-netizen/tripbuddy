"use client";

import { FormEvent, useState } from "react";

import { ApiError } from "@/lib/api";
import { formatINR } from "@/lib/discover";
import { askAssistant, AssistantReply } from "@/lib/trips";
import { Button, FormError, Input } from "@/components/ui";

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
            {t.reply.plan && (
              <div
                className={`rounded-xl border p-3 text-sm ${
                  t.reply.plan.over_budget
                    ? "border-red-300 bg-red-50 text-red-900"
                    : "border-line bg-[#efece4]"
                }`}
              >
                <p className="font-bold">
                  Suggested plan: {formatINR(Number(t.reply.plan.total))}
                  {t.reply.plan.target != null &&
                    ` of ${formatINR(Number(t.reply.plan.target))}`}
                  {t.reply.plan.over_budget && " — over budget"}
                </p>
                <ol className="mt-1 list-decimal pl-5">
                  {t.reply.plan.days.map((d, di) => (
                    <li key={di}>
                      {d.items
                        .map((it) => `${it.title} (${formatINR(Number(it.est_cost))})`)
                        .join(", ")}
                    </li>
                  ))}
                </ol>
                <p className="mt-1 text-xs">{t.reply.plan.disclaimer}</p>
              </div>
            )}
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
