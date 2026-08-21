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
        <h1 className="text-3xl tracking-tight">Saved destinations</h1>
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
            <li key={id} className="card group overflow-hidden">
              <div className="relative h-44 w-full overflow-hidden">
                <Image
                  src={d.image_url}
                  alt={d.name}
                  width={600}
                  height={400}
                  unoptimized
                  className="h-44 w-full object-cover transition duration-300 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 shadow-sm backdrop-blur">
                  {TIER_LABELS[d.budget_tier]}
                </span>
                <div className="absolute inset-x-3 bottom-2.5 flex items-end justify-between gap-2 text-white">
                  <h2 className="text-lg text-white drop-shadow">{d.name}</h2>
                  <span className="whitespace-nowrap rounded-lg bg-white/95 px-2 py-1 text-xs font-bold text-brand-coral-ink shadow">
                    {formatINR(d.avg_daily_budget)}
                    <span className="font-medium text-black/60">/day</span>
                  </span>
                </div>
              </div>
              <div className="p-3">
                <button
                  type="button"
                  onClick={() => remove({ id, destination: d, created_at: "" })}
                  className="w-full rounded-full border border-line-input px-3 py-1.5 text-sm font-semibold text-black/70 transition hover:border-brand-coral-ink hover:text-brand-coral-ink"
                >
                  ♥ Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
