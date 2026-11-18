"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { AppNotification } from "@/lib/messages";

const ICONS: Record<AppNotification["kind"], string> = {
  message: "💬",
  trip_chat: "👥",
  trip_join: "🧳",
  buddy_request: "🤝",
};

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Bell icon with a count and a dropdown of what's waiting on you. */
export function NotificationBell({ items }: { items: AppNotification[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const count = items.length;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={count ? `Notifications, ${count} new` : "Notifications"}
        onClick={() => setOpen((o) => !o)}
        className="relative grid h-9 w-9 place-items-center rounded-full text-text-muted transition hover:bg-surface-alt hover:text-brand-teal"
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-brand-coral-ink px-1 py-0.5 text-[10px] font-semibold leading-none text-white">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-white shadow-xl">
          <p className="border-b border-line px-4 py-2.5 text-sm font-bold text-brand-teal">
            Notifications
          </p>
          {count === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-text-subtle">
              You&apos;re all caught up.
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {items.map((n) => (
                <li key={n.key}>
                  <Link
                    href={n.href}
                    onClick={() => setOpen(false)}
                    className="flex gap-3 px-4 py-3 transition hover:bg-surface-alt"
                  >
                    <span aria-hidden className="text-lg leading-6">
                      {ICONS[n.kind]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-brand-teal">
                        {n.title}
                      </span>
                      {n.preview && (
                        <span className="block truncate text-xs text-text-subtle">
                          {n.preview}
                        </span>
                      )}
                      <span className="block text-[11px] text-text-subtle">
                        {timeAgo(n.created_at)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
