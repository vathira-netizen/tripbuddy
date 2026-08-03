"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";

import {
  formatINR,
  listSaved,
  SavedDestination,
  TIER_LABELS,
  unsaveDestination,
} from "@/lib/discover";

export default function SavedPage() {
  const [rows, setRows] = useState<SavedDestination[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listSaved()
      .then(setRows)
      .finally(() => setLoading(false));
  }, []);

  async function remove(saved: SavedDestination) {
    setRows((prev) => prev.filter((r) => r.id !== saved.id));
    try {
      await unsaveDestination(saved.id);
    } catch {
      setRows((prev) => [...prev, saved]);
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Saved destinations</h1>
        <Link href="/discover" className="text-sm font-medium text-indigo-600">
          ← Discover
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-black/60 dark:text-white/60">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-black/60 dark:text-white/60">
          Nothing saved yet.{" "}
          <Link href="/discover" className="text-indigo-600">
            Find a destination
          </Link>
          .
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {rows.map(({ id, destination: d }) => (
            <li
              key={id}
              className="overflow-hidden rounded-xl border border-black/10 dark:border-white/10"
            >
              <Image
                src={d.image_url}
                alt={d.name}
                width={600}
                height={400}
                unoptimized
                className="h-36 w-full object-cover"
              />
              <div className="space-y-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-semibold">{d.name}</h2>
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                    {TIER_LABELS[d.budget_tier]}
                  </span>
                </div>
                <p className="text-sm text-black/70 dark:text-white/70">
                  {formatINR(d.avg_daily_budget)}/day
                </p>
                <button
                  type="button"
                  onClick={() => remove({ id, destination: d, created_at: "" })}
                  className="w-full rounded-lg border border-black/15 px-3 py-1.5 text-sm font-medium transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
