"use client";

import { useState } from "react";
import Link from "next/link";

const STEPS = [
  {
    title: "Set your travel style & budget",
    body: "Add your bio, travel style and daily budget on your profile so matches and AI plans fit how you actually travel.",
    cta: { href: "/profile", label: "Go to profile" },
  },
  {
    title: "Discover destinations & find buddies",
    body: "Browse budget-fitting destinations, then find travellers who want to go the same place.",
    cta: { href: "/discover", label: "Start discovering" },
  },
  {
    title: "Generate your AI itinerary",
    body: "Create a trip and let the AI draft a day-by-day plan that fits your budget in seconds.",
    cta: { href: "/trips", label: "Plan a trip" },
  },
] as const;

/** Shown once, right after onboarding — see the `?welcome=1` trigger on /discover. */
export default function WelcomeWalkthrough({ onDismiss }: { onDismiss: () => void }) {
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;
  const { title, body, cta } = STEPS[step];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-xl">
        <p className="text-xs font-bold uppercase tracking-wide text-brand-coral-ink">
          Step {step + 1} of {STEPS.length}
        </p>
        <h2 className="mt-1 font-serif text-xl text-brand-teal">{title}</h2>
        <p className="mt-2 text-sm text-text-subtle">{body}</p>

        <div className="mt-4 flex gap-1.5">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full ${
                i <= step ? "bg-brand-teal" : "bg-line"
              }`}
            />
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onDismiss}
            className="text-xs font-semibold text-text-subtle hover:text-brand-teal"
          >
            Skip
          </button>
          <div className="flex gap-2">
            <Link
              href={cta.href}
              onClick={onDismiss}
              className="rounded-full border border-[#d5d9d0] px-4 py-2 text-sm font-semibold text-brand-teal transition hover:border-brand-teal"
            >
              {cta.label}
            </Link>
            <button
              type="button"
              onClick={() => (last ? onDismiss() : setStep((s) => s + 1))}
              className="rounded-full bg-brand-coral px-4 py-2 text-sm font-bold text-white transition hover:brightness-95"
            >
              {last ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
