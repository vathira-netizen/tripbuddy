"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import {
  CODE_LIFETIME_SECONDS,
  formatCountdown,
  formatIndianPhone,
  phoneErrorMessage,
  RESEND_COOLDOWN_SECONDS,
} from "@/lib/phone";
import { OTP_LENGTH, otpSchema, phoneSchema, type Profile } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/client";
import { Button, FormError, Input } from "@/components/ui";

type Stage = "enter" | "code" | "done";

/**
 * Verify a phone number with a one-time SMS code (Supabase phone OTP).
 *
 * The number is sent to Supabase only; TripBuddy's own server just learns that
 * a number has been confirmed. After a successful code we refresh the session so
 * the next API request carries a token with the confirmed number, then read the
 * profile back to make sure the server has caught up.
 */
export default function PhoneVerify({
  verified = false,
  onVerified,
}: {
  /** Whether the profile already has a verified phone. */
  verified?: boolean;
  onVerified?: () => void;
}) {
  const [flowStage, setStage] = useState<Stage>("enter");
  // True after "Use a different number", so an already-verified profile can re-verify.
  const [changingNumber, setChangingNumber] = useState(false);
  // The profile often loads after this mounts, so read `verified` on every render.
  const stage: Stage = verified && !changingNumber && flowStage === "enter" ? "done" : flowStage;
  const [phoneInput, setPhoneInput] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notSyncedYet, setNotSyncedYet] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Tick once a second while a code is out, for the expiry and resend timers.
  useEffect(() => {
    if (stage !== "code") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [stage]);

  const elapsed = sentAt ? (now - sentAt) / 1000 : 0;
  const resendIn = RESEND_COOLDOWN_SECONDS - elapsed;
  const expiresIn = CODE_LIFETIME_SECONDS - elapsed;

  async function confirmWithServer() {
    setBusy(true);
    setError(null);
    try {
      await createClient().auth.refreshSession();
      const profile = await api.get<Profile>("/api/profile/me/");
      if (!profile.phone_verified) {
        setNotSyncedYet(true);
        return;
      }
      setNotSyncedYet(false);
      setStage("done");
      onVerified?.();
    } catch {
      setNotSyncedYet(true);
    } finally {
      setBusy(false);
    }
  }

  async function sendCode(target: string) {
    setBusy(true);
    setError(null);
    try {
      const { data, error: authError } = await createClient().auth.updateUser({ phone: target });
      if (authError) {
        setError(phoneErrorMessage(authError, "send"));
        return;
      }
      // Supabase sends no SMS when this is already the account's confirmed number.
      if (data.user?.phone === target.slice(1) && data.user.phone_confirmed_at) {
        setBusy(false);
        await confirmWithServer();
        return;
      }
      setPhone(target);
      setCode("");
      setSentAt(Date.now());
      setNow(Date.now());
      setStage("code");
    } catch {
      setError(phoneErrorMessage(null, "send"));
    } finally {
      setBusy(false);
    }
  }

  function onSubmitPhone(e: React.FormEvent) {
    e.preventDefault();
    const parsed = phoneSchema.safeParse(phoneInput);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    void sendCode(parsed.data);
  }

  async function onSubmitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!phone) return;
    const parsed = otpSchema.safeParse(code);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    if (expiresIn <= 0) {
      setError("That code has expired. Send a new one.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: authError } = await createClient().auth.verifyOtp({
        phone,
        token: parsed.data,
        type: "phone_change",
      });
      if (authError) {
        setError(phoneErrorMessage(authError, "verify", elapsed));
        setBusy(false);
        return;
      }
    } catch {
      setError(phoneErrorMessage(null, "verify", elapsed));
      setBusy(false);
      return;
    }
    setBusy(false);
    await confirmWithServer();
  }

  function startOver() {
    setChangingNumber(true);
    setStage("enter");
    setPhone(null);
    setCode("");
    setError(null);
    setNotSyncedYet(false);
  }

  if (stage === "done") {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-brand-teal">
          <span aria-hidden="true">✓</span> Your phone number is verified.
        </p>
        <button
          type="button"
          onClick={startOver}
          className="text-xs font-semibold text-text-subtle underline hover:text-brand-teal"
        >
          Use a different number
        </button>
      </div>
    );
  }

  if (notSyncedYet) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-text-muted">
          Your number is confirmed. We&apos;re still updating your profile; this can take up
          to a minute.
        </p>
        <Button type="button" variant="teal" loading={busy} onClick={() => void confirmWithServer()}>
          Check again
        </Button>
      </div>
    );
  }

  if (stage === "code" && phone) {
    return (
      <form onSubmit={onSubmitCode} className="space-y-4" noValidate>
        <p className="text-sm text-text-muted">
          We sent a {OTP_LENGTH}-digit code to <strong>{formatIndianPhone(phone)}</strong>.{" "}
          <button
            type="button"
            onClick={startOver}
            className="font-semibold text-brand-teal underline"
          >
            Change number
          </button>
        </p>
        <Input
          label={`${OTP_LENGTH}-digit code`}
          name="otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={OTP_LENGTH}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          aria-describedby="otp-timer"
        />
        <p id="otp-timer" className="text-xs text-text-subtle" aria-live="polite">
          {expiresIn > 0
            ? `Code expires in ${formatCountdown(expiresIn)}`
            : "This code has expired. Send a new one."}
        </p>
        <FormError message={error} />
        <Button type="submit" variant="coral" loading={busy} disabled={expiresIn <= 0}>
          Verify
        </Button>
        <button
          type="button"
          disabled={busy || resendIn > 0}
          onClick={() => void sendCode(phone)}
          className="w-full text-center text-sm font-semibold text-brand-teal underline disabled:cursor-not-allowed disabled:text-text-subtle disabled:no-underline"
        >
          {resendIn > 0 ? `Resend code in ${formatCountdown(resendIn)}` : "Resend code"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmitPhone} className="space-y-4" noValidate>
      <Input
        label="Mobile number (India)"
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="98765 43210"
        maxLength={20}
        value={phoneInput}
        onChange={(e) => setPhoneInput(e.target.value)}
      />
      <p className="text-xs text-text-subtle">
        We&apos;ll text you a {OTP_LENGTH}-digit code. Other travellers never see your number;
        they only see a &ldquo;phone verified&rdquo; badge.
      </p>
      <FormError message={error} />
      <Button type="submit" variant="coral" loading={busy}>
        Send code
      </Button>
    </form>
  );
}
