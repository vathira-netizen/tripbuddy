import { api } from "@/lib/api";

export type ReportReason =
  | "harassment"
  | "inappropriate_content"
  | "spam"
  | "safety_concern"
  | "other";

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: "harassment", label: "Harassment" },
  { value: "inappropriate_content", label: "Inappropriate content" },
  { value: "spam", label: "Spam" },
  { value: "safety_concern", label: "Safety concern" },
  { value: "other", label: "Other" },
];

export const submitReport = (
  supabaseUserId: string,
  reason: ReportReason,
  details: string,
) =>
  api.post("/api/reports/", {
    reported_user_id: supabaseUserId,
    reason,
    details,
  });
