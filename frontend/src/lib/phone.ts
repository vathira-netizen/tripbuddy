/**
 * Phone verification helpers shared by the verify form and the buddy pages.
 *
 * Kept free of React and of the Supabase client so the rules are unit-testable.
 */

/** The `code` the backend sends with a 403 when a buddy feature needs a verified phone. */
export const PHONE_VERIFICATION_REQUIRED = "phone_verification_required";

/** Where to send someone to verify: the profile editor's phone section. */
export const VERIFY_PHONE_HREF = "/profile?edit=1#verify-phone";

/** How long an SMS code is valid (Supabase → Auth → Providers → Phone → OTP expiry). */
export const CODE_LIFETIME_SECONDS = 60;

/** Wait this long before offering to resend (matches Supabase's per-number SMS interval). */
export const RESEND_COOLDOWN_SECONDS = 60;

/** True when an API error means "verify your phone first". */
export function needsPhoneVerification(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const { status, data } = err as { status?: unknown; data?: unknown };
  return (
    status === 403 &&
    typeof data === "object" &&
    data !== null &&
    (data as { code?: unknown }).code === PHONE_VERIFICATION_REQUIRED
  );
}

/** `m:ss`, for the resend and expiry timers. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "+919876543210" → "+91 98765 43210", for showing back to the user. */
export function formatIndianPhone(e164: string): string {
  const digits = e164.replace(/^\+91/, "");
  return digits.length === 10 ? `+91 ${digits.slice(0, 5)} ${digits.slice(5)}` : e164;
}

type AuthErrorLike = { code?: unknown; status?: unknown };

const RATE_LIMITED = new Set(["over_sms_send_rate_limit", "over_request_rate_limit"]);
const SIGNED_OUT = new Set(["no_authorization", "session_not_found", "bad_jwt", "user_not_found"]);
const SMS_UNAVAILABLE = new Set(["phone_provider_disabled", "sms_send_failed"]);

/**
 * A short, human message for a Supabase Auth error. Never the raw error.
 *
 * Supabase answers a wrong code and an expired code the same way
 * (`otp_expired`), so `codeAgeSeconds` tells them apart.
 */
export function phoneErrorMessage(
  err: unknown,
  stage: "send" | "verify",
  codeAgeSeconds = 0,
): string {
  const { code, status } = (typeof err === "object" && err !== null ? err : {}) as AuthErrorLike;
  const c = typeof code === "string" ? code : "";

  if (status === 429 || RATE_LIMITED.has(c)) {
    return "Too many attempts. Wait a minute, then try again.";
  }
  if (SIGNED_OUT.has(c)) {
    return "Your session has ended. Sign in again, then verify your phone.";
  }
  if (c === "phone_exists") {
    return "That number is already linked to another TripBuddy account.";
  }
  if (SMS_UNAVAILABLE.has(c)) {
    return "We couldn't send a text right now. Please try again later.";
  }
  if (stage === "verify" && (c === "otp_expired" || c === "otp_disabled" || status === 403)) {
    return codeAgeSeconds >= CODE_LIFETIME_SECONDS
      ? "That code has expired. Send a new one."
      : "That code isn't right. Check the SMS and try again.";
  }
  if (stage === "send" && c === "validation_failed") {
    return "That number doesn't look right. Check it and try again.";
  }
  return stage === "send"
    ? "Couldn't send the code. Try again."
    : "Couldn't check that code. Try again.";
}
