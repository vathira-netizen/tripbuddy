import Link from "next/link";

import { createClient } from "@/lib/supabase/server";

const FEATURES = [
  { icon: "🧭", title: "Discover", desc: "Budget-fitting destinations near you, on a live map.", href: "/discover" },
  { icon: "🤝", title: "Find buddies", desc: "Match with compatible travellers going your way.", href: "/buddies" },
  { icon: "🗺️", title: "Plan together", desc: "Drag-and-drop day-by-day itineraries, shared live.", href: "/trips" },
  { icon: "💰", title: "Budget planner", desc: "Track every rupee and export the whole trip.", href: "/trips" },
  { icon: "💬", title: "Message", desc: "Chat with your crew in real time before you go.", href: "/messages" },
  { icon: "✨", title: "AI itineraries", desc: "Generate a plan that fits your budget in seconds.", href: "/trips" },
];

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const primaryHref = user ? "/discover" : "/register";

  return (
    <main className="flex-1">
      {/* Hero banner */}
      <section className="brand-teal relative overflow-hidden text-white">
        <div className="mx-auto w-full max-w-6xl px-4 pb-28 pt-16 text-center sm:pt-20">
          <h1 className="text-4xl text-white tracking-tight sm:text-5xl">
            Plan trips around your <span className="text-brand-coral">budget</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-white/85">
            Discover budget-fitting destinations, find compatible travel buddies
            nearby, and plan a day-by-day itinerary together.
          </p>
        </div>

        {/* Floating search card, overlapping the section below (MMT-style). */}
        <div className="mx-auto -mb-24 w-full max-w-5xl px-4">
          <form
            action={primaryHref}
            className="card grid grid-cols-1 gap-3 p-4 text-left text-foreground sm:grid-cols-[1.4fr_1fr_1fr_auto] sm:items-end"
          >
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60">
                Where to?
              </span>
              <input
                name="q"
                placeholder="Goa, Manali, Jaipur…"
                className="w-full rounded-xl border border-line-input bg-white px-3.5 py-2.5 text-sm shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60">
                Max budget
              </span>
              <select className="w-full rounded-xl border border-line-input bg-white px-3.5 py-2.5 text-sm shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25">
                <option>Any</option>
                <option>Under ₹10,000</option>
                <option>Under ₹25,000</option>
                <option>Under ₹50,000</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60">
                Travellers
              </span>
              <select className="w-full rounded-xl border border-line-input bg-white px-3.5 py-2.5 text-sm shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25">
                <option>Just me</option>
                <option>2 travellers</option>
                <option>3+ travellers</option>
              </select>
            </label>
            <button
              type="submit"
              className="cta-coral inline-flex h-[46px] items-center justify-center rounded-full px-8 text-sm font-bold text-white shadow-md transition hover:brightness-105"
            >
              Search
            </button>
          </form>
        </div>
      </section>

      {/* Feature grid */}
      <section className="mx-auto w-full max-w-6xl px-4 pb-16 pt-36">
        <h2 className="mb-6 text-center text-3xl tracking-tight">
          Everything for your trip, in one place
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Link
              key={f.title}
              href={user ? f.href : "/register"}
              className="card group flex flex-col gap-2 p-5 transition hover:-translate-y-0.5 hover:shadow-lg"
            >
              <span aria-hidden className="text-3xl">{f.icon}</span>
              <span className="text-lg font-bold group-hover:text-indigo-600">{f.title}</span>
              <span className="text-sm text-black/60">{f.desc}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* CTA band */}
      <section className="mx-auto mb-16 w-full max-w-6xl px-4">
        <div className="brand-teal flex flex-col items-center gap-4 rounded-3xl px-6 py-12 text-center text-white sm:flex-row sm:justify-between sm:text-left">
          <div>
            <h2 className="text-2xl text-white">Ready to plan your next trip?</h2>
            <p className="mt-1 text-white/85">Join TripBuddy and start exploring within your budget.</p>
          </div>
          <div className="flex gap-3">
            {user ? (
              <Link href="/discover" className="cta-coral rounded-full px-6 py-3 text-sm font-bold shadow-md">
                Start exploring
              </Link>
            ) : (
              <>
                <Link href="/register" className="cta-coral rounded-full px-6 py-3 text-sm font-bold shadow-md">
                  Get started
                </Link>
                <Link href="/login" className="rounded-full border border-white/40 px-6 py-3 text-sm font-bold text-white transition hover:bg-white/10">
                  Sign in
                </Link>
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
