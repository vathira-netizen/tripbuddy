import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Cookies & privacy · TripBuddy",
  description: "What TripBuddy stores in your browser and on its servers, and why.",
};

const BROWSER_ITEMS = [
  {
    name: "sb-…-auth-token",
    kind: "Cookie · essential",
    purpose: "Keeps you signed in. It holds your Supabase session.",
    lifetime:
      "7 days, renewed each time you use the site. If you tick “Remember me” when you log in, it lasts 400 days. Removed when you sign out.",
  },
  {
    name: "tb-remember",
    kind: "Cookie · essential",
    purpose: "Remembers that you ticked “Remember me”. Holds no personal data.",
    lifetime: "400 days. Removed when you sign out.",
  },
  {
    name: "sb-…-code-verifier",
    kind: "Cookie · essential",
    purpose: "Used briefly while you confirm your email or reset your password.",
    lifetime: "Minutes. Removed once the step is done.",
  },
  {
    name: "tb:discover-origin",
    kind: "Browser storage · convenience",
    purpose:
      "Your “Travelling from” choice on Discover, so you don’t have to set it each visit. A current location is rounded to about 1 km first.",
    lifetime:
      "Until you change it or clear your browser data. Its rounded coordinates go along with Discover searches to measure distances; they aren't saved.",
  },
];

const SERVICES = [
  ["Supabase", "Sign-in, and storing profile photos and trip covers."],
  ["OpenStreetMap", "Map tiles on Discover and destination pages."],
  ["Wikimedia Commons and Unsplash", "Destination photos and sample traveller photos."],
  ["QR Server", "Draws the UPI QR code when you settle up a trip budget."],
];

/** Public page: linked from the footer and the landing page; no login needed. */
export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <h1 className="font-serif text-4xl leading-tight text-brand-teal">Cookies &amp; privacy</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-text-muted">
        TripBuddy stores only what it needs to sign you in and remember a couple of your
        settings. There are <strong className="text-brand-teal">no advertising, analytics or
        tracking cookies</strong>, which is why you don&apos;t see a cookie banner.
      </p>

      <section className="mt-8">
        <h2 className="font-serif text-2xl text-brand-teal">What&apos;s stored in your browser</h2>
        <ul className="mt-4 space-y-3">
          {BROWSER_ITEMS.map((item) => (
            <li key={item.name} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <code className="rounded-md bg-surface-alt px-2 py-0.5 text-sm font-semibold text-brand-teal">
                  {item.name}
                </code>
                <span className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
                  {item.kind}
                </span>
              </div>
              <p className="mt-2 text-sm text-foreground">{item.purpose}</p>
              <p className="mt-1 text-sm text-text-subtle">
                <span className="font-semibold text-text-muted">How long: </span>
                {item.lifetime}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10 space-y-3 text-[15px] leading-relaxed text-text-muted">
        <h2 className="font-serif text-2xl text-brand-teal">What we keep on our servers</h2>
        <p>
          The profile details you enter, your trips, budgets, reviews and messages. For buddy
          matching we keep only an <strong className="text-brand-teal">approximate point for your
          city</strong>, rounded to about 1 km, never your exact location. If you use
          “Use my current location” on Discover, it is rounded in your browser and used only to
          measure distances. It isn&apos;t saved to your profile.
        </p>
        <p>
          The AI trip assistant runs on our server. Your browser never talks to the AI provider
          directly, and the provider receives only the trip details needed to answer.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-2xl text-brand-teal">Other services your browser contacts</h2>
        <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-surface">
          {SERVICES.map(([name, why]) => (
            <li key={name} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:gap-4">
              <span className="w-56 shrink-0 text-sm font-semibold text-brand-teal">{name}</span>
              <span className="text-sm text-text-muted">{why}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-text-subtle">
          Our security policy blocks the browser from loading scripts, images or connections from
          anywhere else.
        </p>
      </section>

      <section className="mt-10 space-y-3 text-[15px] leading-relaxed text-text-muted">
        <h2 className="font-serif text-2xl text-brand-teal">Clearing it</h2>
        <p>
          Signing out removes the sign-in cookies and your “Remember me” choice. To remove
          everything, clear this site&apos;s data in your browser settings. To delete your account
          and the data we hold, open an issue on{" "}
          <a
            href="https://github.com/vathira-netizen/tripbuddy/issues"
            className="font-semibold text-brand-coral-ink underline underline-offset-2"
          >
            GitHub
          </a>
          .
        </p>
      </section>

      <p className="mt-10 text-sm">
        <Link href="/" className="font-semibold text-brand-teal hover:text-brand-coral-ink">
          ← Back to TripBuddy
        </Link>
      </p>
    </main>
  );
}
