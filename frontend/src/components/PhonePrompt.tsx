"use client";

import Link from "next/link";
import { toast } from "sonner";

import { VERIFY_PHONE_HREF } from "@/lib/phone";

/** Inline prompt where a buddy feature is blocked until the phone is verified. */
export function PhonePrompt({ action = "find travel buddies" }: { action?: string }) {
  return (
    <div
      role="status"
      className="rounded-xl border border-line bg-surface-alt p-6 text-center"
    >
      <p className="font-semibold text-brand-teal">Verify your phone to {action}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-text-subtle">
        Every buddy on TripBuddy has a verified phone number. It keeps the
        community safe. It takes a minute, and no one else sees your number.
      </p>
      <Link
        href={VERIFY_PHONE_HREF}
        className="mt-4 inline-flex rounded-full bg-brand-coral px-5 py-2 text-sm font-bold text-white hover:opacity-90"
      >
        Verify phone
      </Link>
    </div>
  );
}

/** The same prompt as a toast, for actions taken from a button. */
export function toastPhoneRequired() {
  toast.error("Verify your phone number to use buddy features.", {
    id: "phone-required",
    action: {
      label: "Verify",
      onClick: () => window.location.assign(VERIFY_PHONE_HREF),
    },
  });
}
