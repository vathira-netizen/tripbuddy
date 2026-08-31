"use client";

import { useState } from "react";
import { toast } from "sonner";

import { REPORT_REASONS, ReportReason, submitReport } from "@/lib/moderation";
import { Select } from "@/components/ui";

/**
 * Small confirm-style dialog for filing a safety report. Shared by the
 * traveller profile modal and the chat thread header so the form isn't
 * duplicated between the two entry points.
 */
export default function ReportUserDialog({
  supabaseUserId,
  displayName,
  onClose,
}: {
  supabaseUserId: string;
  displayName: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<ReportReason>("harassment");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await submitReport(supabaseUserId, reason, details.trim());
      toast.success(`Report sent — thanks for flagging ${displayName}`);
      onClose();
    } catch {
      toast.error("Couldn't send that report. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Report ${displayName}`}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm space-y-3 rounded-2xl bg-surface p-5 shadow-xl"
      >
        <h2 className="font-serif text-lg text-brand-teal">Report {displayName}</h2>
        <Select
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value as ReportReason)}
        >
          {REPORT_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
        <div className="space-y-1">
          <label htmlFor="report-details" className="block text-xs text-text-subtle">
            Details (optional)
          </label>
          <textarea
            id="report-details"
            rows={3}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="What happened?"
            className="w-full rounded-xl border border-line-input bg-white px-3.5 py-2.5 text-sm shadow-sm outline-none transition focus:border-brand-coral focus:ring-2 focus:ring-brand-coral/30"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-2 text-sm font-semibold text-text-subtle hover:text-brand-teal"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-full bg-brand-coral px-4 py-2 text-sm font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Sending…" : "Submit report"}
          </button>
        </div>
      </div>
    </div>
  );
}
