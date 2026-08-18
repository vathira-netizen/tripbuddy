"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { getUnreadSummary, type UnreadSummary } from "@/lib/messages";

// Routes where the app nav shouldn't show: landing + auth + onboarding.
const HIDDEN = ["/", "/login", "/register", "/reset-password", "/update-password", "/onboarding"];

const LINKS = [
  { href: "/discover", label: "Discover" },
  { href: "/trips", label: "Trips" },
  { href: "/buddies", label: "Buddies", badge: "requests" as const },
  { href: "/messages", label: "Messages", badge: "messages" as const },
  { href: "/profile", label: "Profile" },
];

// The badges are a convenience, not a notification system: a poll keeps them
// roughly current without a second Realtime subscription living in the chrome
// of every page. Deliberately slow — the thread itself is live.
const POLL_MS = 60_000;

export function Nav() {
  const pathname = usePathname();
  const hidden = HIDDEN.includes(pathname) || pathname.startsWith("/share/");

  const [summary, setSummary] = useState<UnreadSummary | null>(null);

  useEffect(() => {
    if (hidden) return;

    let cancelled = false;

    const load = async () => {
      try {
        const next = await getUnreadSummary();
        if (!cancelled) setSummary(next);
      } catch {
        // A signed-out or offline user simply gets no badges.
      }
    };

    void load();
    const timer = setInterval(() => void load(), POLL_MS);

    // Re-check when the tab regains focus, so a badge cleared elsewhere or a
    // message received while away shows up without waiting out the interval.
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
    // pathname: navigating (e.g. opening a thread, which marks it read) should
    // refresh the counts.
  }, [hidden, pathname]);

  // Public read-only share pages have no app chrome (viewers may be logged out).
  if (hidden) return null;

  const counts = {
    messages: summary?.unread_messages ?? 0,
    requests: summary?.pending_requests ?? 0,
  };

  return (
    <nav className="brand-gradient sticky top-0 z-40 shadow-md">
      {/* Wraps rather than overflowing: six items do not fit on a 375px
          viewport, and a nav that pushes the page sideways is unusable on a
          phone. */}
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link
          href="/discover"
          className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-white"
        >
          <span aria-hidden className="text-xl">✈️</span>
          Trip<span className="text-brand-amber">Buddy</span>
        </Link>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-sm">
          {LINKS.map(({ href, label, badge }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            const count = badge ? counts[badge] : 0;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-medium transition ${
                  active
                    ? "bg-white text-indigo-700 shadow-sm"
                    : "text-white/85 hover:bg-white/15 hover:text-white"
                }`}
              >
                {label}
                {count > 0 && <Badge count={count} label={label} />}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

function Badge({ count, label }: { count: number; label: string }) {
  return (
    <span
      // aria-live so a count arriving from a poll is announced rather than
      // silently changing under a screen-reader user.
      aria-live="polite"
      className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-indigo-600 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white"
    >
      {count > 9 ? "9+" : count}
      <span className="sr-only"> unread {label.toLowerCase()}</span>
    </span>
  );
}
