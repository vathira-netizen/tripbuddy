"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { api } from "@/lib/api";
import {
  BudgetCategory,
  BudgetItem,
  BudgetSummary,
  downloadBudgetCsv,
  fetchBudgetSummary,
  listBudgetItems,
} from "@/lib/budget";
import BudgetEditor from "@/components/BudgetEditor";
import { PerDayPanel, PerPersonPanel, RunningTotalBar } from "@/components/BudgetSummaryPanels";
import CategoryBreakdownChart, { CategoryTotal } from "@/components/CategoryBreakdownChart";
import SettleUpPanel from "@/components/SettleUpPanel";

interface Trip {
  id: number;
  title: string;
}

export default function TripBudgetPage() {
  const params = useParams<{ id: string }>();
  const tripId = Number(params.id);

  const [trip, setTrip] = useState<Trip | null>(null);
  const [items, setItems] = useState<BudgetItem[]>([]);
  const [summary, setSummary] = useState<BudgetSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const refreshSummary = useCallback(() => {
    fetchBudgetSummary(tripId)
      .then(setSummary)
      .catch(() => setError("Couldn't refresh the summary."));
  }, [tripId]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);
      return Promise.all([
        api.get<Trip>(`/api/trips/${tripId}/`),
        listBudgetItems(tripId),
        fetchBudgetSummary(tripId),
      ]);
    };

    run()
      .then(([tripData, itemsData, summaryData]) => {
        if (cancelled) return;
        setTrip(tripData);
        setItems(itemsData);
        setSummary(summaryData);
      })
      .catch(() => !cancelled && setError("Couldn't load this trip's budget."))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [tripId]);

  function handleItemsChange(next: BudgetItem[]) {
    setItems(next);
    refreshSummary();
  }

  async function handleDownload() {
    setDownloading(true);
    setError(null);
    try {
      await downloadBudgetCsv(tripId);
    } catch {
      setError("Couldn't download the CSV. Try again.");
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
        <p className="text-sm text-black/60 dark:text-white/60">Loading…</p>
      </main>
    );
  }

  if (!summary) {
    return (
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          {error ?? "Couldn't load this trip's budget."}
        </p>
      </main>
    );
  }

  const categoryData: CategoryTotal[] = Object.entries(summary.category_totals).map(
    ([category, amount]) => ({
      category: category as BudgetCategory,
      amount: Number(amount),
    }),
  );

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl tracking-tight">
            {trip?.title ?? "Trip"} budget
          </h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            {summary.nights} night{summary.nights === 1 ? "" : "s"}
          </p>
        </div>
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          className="shrink-0 rounded-lg border border-line-input px-4 py-2 text-sm font-medium transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10"
        >
          {downloading ? "Preparing…" : "Download CSV"}
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <section className="card p-4">
        <RunningTotalBar runningTotal={summary.running_total} />
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-3 text-sm font-semibold">Category breakdown</h2>
          <CategoryBreakdownChart data={categoryData} />
        </section>
        <section className="card p-4">
          <h2 className="mb-3 text-sm font-semibold">Per day</h2>
          <PerDayPanel perDay={summary.per_day} />
        </section>
      </div>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold">Per person</h2>
        <PerPersonPanel perPerson={summary.per_person} members={summary.members} />
      </section>

      <SettleUpPanel settlements={summary.settlements} members={summary.members} />

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold">Budget items</h2>
        <BudgetEditor
          tripId={tripId}
          items={items}
          members={summary.members}
          onItemsChange={handleItemsChange}
        />
      </section>
    </main>
  );
}
