"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { avatarTint, Connection, initials, listConnections } from "@/lib/buddies";

/** Travellers you're already connected with — same fetch already used to
 * populate the trip-invite picker on /trips/[id]. */
export function FriendsList() {
  const [friends, setFriends] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listConnections({ status: "accepted" })
      .then((rows) => !cancelled && setFriends(rows))
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <section aria-busy="true" className="card p-4">
        <h2 className="">Friends</h2>
        <p className="mt-2 text-sm text-black/60 dark:text-white/60">Loading…</p>
      </section>
    );
  }

  if (friends.length === 0) {
    return (
      <section className="card p-4">
        <h2 className="">Friends</h2>
        <p className="mt-2 text-sm text-black/60 dark:text-white/60">
          No connections yet — send a request from a buddy card.
        </p>
      </section>
    );
  }

  return (
    <section className="card p-4">
      <h2 className="">
        Friends{" "}
        <span className="ml-1 rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white">
          {friends.length}
        </span>
      </h2>
      <ul className="mt-3 space-y-2.5">
        {friends.map((friend) => (
          <li key={friend.id} className="flex items-center gap-3">
            {friend.other?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- user-supplied external URL
              <img
                src={friend.other.avatar_url}
                alt=""
                className="h-9 w-9 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span
                aria-hidden="true"
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarTint(
                  friend.other?.supabase_user_id ?? String(friend.id),
                )}`}
              >
                {initials(friend.other?.display_name ?? "?")}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {friend.other?.display_name ?? "A traveller"}
              </p>
              <p className="truncate text-xs text-black/60 dark:text-white/60">
                {friend.other?.area_label || "Area not set"}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <Link
        href="/messages"
        className="mt-3 inline-block text-xs font-semibold text-indigo-600"
      >
        Message a friend →
      </Link>
    </section>
  );
}
