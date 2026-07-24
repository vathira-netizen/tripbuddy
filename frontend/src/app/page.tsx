import Link from "next/link";

import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
        Plan trips around your <span className="text-indigo-600">budget</span>
      </h1>
      <p className="mt-4 max-w-md text-black/60 dark:text-white/60">
        Discover budget-fitting destinations, find compatible travel buddies
        nearby, and plan a day-by-day itinerary together.
      </p>
      <div className="mt-8 flex gap-3">
        {user ? (
          <Link
            href="/profile"
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500"
          >
            Go to your profile
          </Link>
        ) : (
          <>
            <Link
              href="/register"
              className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500"
            >
              Get started
            </Link>
            <Link
              href="/login"
              className="rounded-lg border border-black/15 px-5 py-2.5 text-sm font-semibold transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              Sign in
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
