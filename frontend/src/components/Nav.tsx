"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Routes where the app nav shouldn't show: landing + auth + onboarding.
const HIDDEN = ["/", "/login", "/register", "/reset-password", "/update-password", "/onboarding"];

const LINKS = [
  { href: "/discover", label: "Discover" },
  { href: "/trips", label: "Trips" },
  { href: "/buddies", label: "Buddies" },
  { href: "/profile", label: "Profile" },
];

export function Nav() {
  const pathname = usePathname();
  // Public read-only share pages have no app chrome (viewers may be logged out).
  if (HIDDEN.includes(pathname) || pathname.startsWith("/share/")) return null;

  return (
    <nav className="border-b border-black/10 dark:border-white/15">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-6 px-4 py-3">
        <Link href="/discover" className="font-bold tracking-tight">
          TripBuddy
        </Link>
        <div className="flex gap-4 text-sm">
          {LINKS.map(({ href, label }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "font-semibold text-indigo-600"
                    : "text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white"
                }
              >
                {label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
