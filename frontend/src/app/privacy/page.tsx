import type { Metadata } from "next";
import Link from "next/link";

import { PRIVACY_UPDATED_LABEL } from "@/lib/privacy";

export const metadata: Metadata = {
  title: "Privacy · TripBuddy",
  description: "What TripBuddy collects, why, and who can see it.",
};

const COLLECT = [
  {
    title: "Your account",
    body: "Your email address and password. Your password is stored securely and nobody at TripBuddy can read it.",
  },
  {
    title: "Your profile",
    body: "Your name, photo, short bio, age range, gender, languages, interests, travel budget and the city you're based in. Adding a UPI ID is optional.",
  },
  {
    title: "What you add",
    body: "Your trips, plans, budgets, reviews, messages, saved places and travel buddies.",
  },
  {
    title: "Your location",
    body: "Only the city you type in. If you choose “Use my current location” on Discover, your browser asks you first, and it's used for that search only. It isn't saved to your profile.",
  },
];

const USES = [
  "Suggesting travel buddies near you who share your interests, budget and languages.",
  "Running your trips: shared plans, group budgets and chat with your group.",
  "Answering the trip assistant. The trip details you ask about are sent to our AI provider to write suggestions.",
  "Keeping TripBuddy safe: confirming your email and looking into reports about other users.",
];

const SERVICES = [
  ["Supabase", "Stores your account, profile, trips and photos."],
  ["AI provider", "Writes trip assistant suggestions."],
  ["OpenStreetMap", "Shows maps."],
  ["QR-code service", "Shows a UPI QR code when you settle up a trip budget."],
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-serif text-2xl text-brand-teal">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-text-muted">{children}</div>
    </section>
  );
}

/** Public page, linked from the footer, the landing page and sign-up. No login needed. */
export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <h1 className="font-serif text-4xl leading-tight text-brand-teal">Your privacy</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-text-muted">
        This page explains what TripBuddy collects, why we need it and who can see it.{" "}
        <strong className="text-brand-teal">We don&apos;t sell your data or show you ads</strong>.
      </p>
      <p className="mt-2 text-sm text-text-subtle">Last updated {PRIVACY_UPDATED_LABEL}</p>

      <Section title="What we collect">
        <ul className="grid gap-3 sm:grid-cols-2">
          {COLLECT.map((item) => (
            <li key={item.title} className="rounded-2xl border border-line bg-surface p-4">
              <p className="font-semibold text-brand-teal">{item.title}</p>
              <p className="mt-1 text-sm">{item.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="How we use it">
        <ul className="list-disc space-y-1.5 pl-5">
          {USES.map((use) => (
            <li key={use}>{use}</li>
          ))}
        </ul>
      </Section>

      <Section title="Who can see what">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-line bg-surface p-4">
            <p className="font-semibold text-brand-teal">Other travellers can see</p>
            <p className="mt-1 text-sm">
              Your name, photo, bio, age range, gender, languages, interests, budget style, your
              city, places you&apos;ve travelled to, and roughly how far away you are (for example
              “10–25 km”).
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-4">
            <p className="font-semibold text-brand-teal">Kept private</p>
            <p className="mt-1 text-sm">
              Your email, password, exact location and daily budget. Your UPI ID is shown only to
              people in your trip who owe you money. Messages are seen only by the people in that
              chat.
            </p>
          </div>
        </div>
      </Section>

      <Section title="Cookies">
        <p>
          We use cookies only to keep you signed in, and to keep you signed in for longer if you
          tick “Remember me”. Your browser also remembers your “Travelling from” choice on
          Discover so you don&apos;t have to set it each time.
        </p>
        <p>
          There are <strong className="text-brand-teal">no advertising, analytics or tracking
          cookies</strong>, which is why you don&apos;t see a cookie banner.
        </p>
      </Section>

      <Section title="Services that help run TripBuddy">
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {SERVICES.map(([name, why]) => (
            <li key={name} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:gap-4">
              <span className="w-44 shrink-0 text-sm font-semibold text-brand-teal">{name}</span>
              <span className="text-sm">{why}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-text-subtle">
          Each one gets only what it needs to do its job.
        </p>
      </Section>

      <Section title="Your choices">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>You can change or remove your profile details at any time from your profile.</li>
          <li>Signing out removes the sign-in cookies from your browser.</li>
          <li>
            To delete your account and everything we hold about you,{" "}
            <a
              href="https://github.com/vathira-netizen/tripbuddy/issues"
              className="font-semibold text-brand-coral-ink underline underline-offset-2"
            >
              contact us
            </a>
            .
          </li>
        </ul>
      </Section>

      <p className="mt-10 text-sm">
        <Link href="/" className="font-semibold text-brand-teal hover:text-brand-coral-ink">
          ← Back to TripBuddy
        </Link>
      </p>
    </main>
  );
}
