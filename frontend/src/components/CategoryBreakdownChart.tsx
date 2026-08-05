"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { BudgetCategory, formatINR } from "@/lib/budget";

export interface CategoryTotal {
  category: BudgetCategory;
  amount: number;
}

// Tailwind indigo/teal/amber/rose/slate — distinct at a glance, consistent
// with the indigo accent used across auth/profile.
const COLORS: Record<BudgetCategory, string> = {
  Transport: "#6366f1",
  Stay: "#0d9488",
  Food: "#d97706",
  Activities: "#e11d48",
  Other: "#64748b",
};

/** Donut chart of a trip's spend by category. Renders nothing for an empty budget. */
export default function CategoryBreakdownChart({ data }: { data: CategoryTotal[] }) {
  const totals = data.filter((d) => d.amount > 0);
  if (totals.length === 0) {
    return (
      <p className="text-sm text-black/60 dark:text-white/60">
        No budget items yet.
      </p>
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={totals}
            dataKey="amount"
            nameKey="category"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={2}
          >
            {totals.map((entry) => (
              <Cell key={entry.category} fill={COLORS[entry.category]} />
            ))}
          </Pie>
          <Tooltip formatter={(value) => formatINR(Number(value))} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
