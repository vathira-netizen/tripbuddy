"use client";

import { FormEvent, useState } from "react";

import {
  BUDGET_CATEGORIES,
  BudgetCategory,
  BudgetItem,
  createBudgetItem,
  deleteBudgetItem,
  formatINR,
  updateBudgetItem,
} from "@/lib/budget";
import { Input, Select } from "@/components/ui";

interface Draft {
  category: BudgetCategory;
  label: string;
  amount: string;
}

const emptyDraft: Draft = { category: "Food", label: "", amount: "" };

/** Add/edit/remove rows for a trip's budget items. Persists each change immediately. */
export default function BudgetEditor({
  tripId,
  items,
  onItemsChange,
}: {
  tripId: number;
  items: BudgetItem[];
  onItemsChange: (items: BudgetItem[]) => void;
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!draft.label.trim() || !draft.amount) return;

    setSaving(true);
    setError(null);
    try {
      const created = await createBudgetItem(tripId, draft);
      onItemsChange([...items, created]);
      setDraft(emptyDraft);
    } catch {
      setError("Couldn't add that item. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(item: BudgetItem) {
    setEditingId(item.id);
    setEditDraft({ category: item.category, label: item.label, amount: item.amount });
    setError(null);
  }

  async function handleSaveEdit(id: number) {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateBudgetItem(id, editDraft);
      onItemsChange(items.map((i) => (i.id === id ? updated : i)));
      setEditingId(null);
    } catch {
      setError("Couldn't save that change. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    setSaving(true);
    setError(null);
    try {
      await deleteBudgetItem(id);
      onItemsChange(items.filter((i) => i.id !== id));
    } catch {
      setError("Couldn't remove that item. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const cellInput =
    "w-full rounded border border-line-input bg-white px-2 py-1 text-sm outline-none focus:border-indigo-500 dark:border-white/20";

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-black/60 dark:border-white/10 dark:text-white/60">
              <th className="py-2 pr-2 font-medium">Category</th>
              <th className="py-2 pr-2 font-medium">Label</th>
              <th className="py-2 pr-2 text-right font-medium">Amount</th>
              <th className="py-2 pl-2" />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="py-6 text-center text-black/60 dark:text-white/60"
                >
                  No budget items yet — add your first one below.
                </td>
              </tr>
            )}
            {items.map((item) => {
              const isEditing = editingId === item.id;
              return (
                <tr
                  key={item.id}
                  className="border-b border-black/5 dark:border-white/5"
                >
                  {isEditing ? (
                    <>
                      <td className="py-2 pr-2">
                        <select
                          aria-label="Category"
                          value={editDraft.category}
                          onChange={(e) =>
                            setEditDraft((d) => ({
                              ...d,
                              category: e.target.value as BudgetCategory,
                            }))
                          }
                          className={cellInput}
                        >
                          {BUDGET_CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          aria-label="Label"
                          value={editDraft.label}
                          onChange={(e) =>
                            setEditDraft((d) => ({ ...d, label: e.target.value }))
                          }
                          className={cellInput}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          aria-label="Amount"
                          type="number"
                          step="0.01"
                          min="0"
                          value={editDraft.amount}
                          onChange={(e) =>
                            setEditDraft((d) => ({ ...d, amount: e.target.value }))
                          }
                          className={`${cellInput} text-right`}
                        />
                      </td>
                      <td className="whitespace-nowrap py-2 pl-2 text-right text-xs">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => handleSaveEdit(item.id)}
                          className="font-medium text-indigo-600 disabled:opacity-60"
                        >
                          Save
                        </button>{" "}
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="text-black/60 dark:text-white/60"
                        >
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="py-2 pr-2">{item.category}</td>
                      <td className="py-2 pr-2">{item.label}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {formatINR(item.amount)}
                      </td>
                      <td className="whitespace-nowrap py-2 pl-2 text-right text-xs">
                        <button
                          type="button"
                          onClick={() => startEdit(item)}
                          className="font-medium text-indigo-600"
                        >
                          Edit
                        </button>{" "}
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => handleDelete(item.id)}
                          className="font-medium text-red-600 disabled:opacity-60"
                        >
                          Remove
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <form
        onSubmit={handleAdd}
        className="flex flex-wrap items-end gap-2 border-t border-black/10 pt-4 dark:border-white/10"
      >
        <div className="w-36">
          <Select
            label="Category"
            name="category"
            value={draft.category}
            onChange={(e) =>
              setDraft((d) => ({ ...d, category: e.target.value as BudgetCategory }))
            }
          >
            {BUDGET_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-[10rem] flex-1">
          <Input
            label="Label"
            name="label"
            value={draft.label}
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            placeholder="e.g. Flight to Goa"
          />
        </div>
        <div className="w-32">
          <Input
            label="Amount (₹)"
            name="amount"
            type="number"
            step="0.01"
            min="0"
            value={draft.amount}
            onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
            placeholder="0.00"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Adding…" : "Add"}
        </button>
      </form>
    </div>
  );
}
