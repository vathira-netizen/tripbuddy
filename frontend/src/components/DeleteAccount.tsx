"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ApiError, api } from "@/lib/api";
import { createClient, setRememberMe } from "@/lib/supabase/client";

const CONFIRM_WORD = "DELETE";

/** Permanently deletes the signed-in user's account, behind a typed confirmation. */
export function DeleteAccount() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setTyped("");
    setError(null);
  }

  async function onDelete(e: React.FormEvent) {
    e.preventDefault();
    if (typed !== CONFIRM_WORD) return;
    setDeleting(true);
    setError(null);
    try {
      await api.post("/api/profile/delete-account/", { confirm: CONFIRM_WORD });
    } catch (err) {
      const detail =
        err instanceof ApiError
          ? (err.data as { detail?: string } | undefined)?.detail
          : undefined;
      setError(detail ?? "We couldn't delete your account. Please try again.");
      setDeleting(false);
      return;
    }
    // The account no longer exists on the server; just clear this browser.
    await createClient().auth.signOut({ scope: "local" });
    setRememberMe(false);
    toast.success("Your account and data have been deleted.");
    router.push("/");
    router.refresh();
  }

  return (
    <section
      aria-labelledby="delete-account-heading"
      className="mt-12 rounded-2xl border border-line bg-surface p-5"
    >
      <h2 id="delete-account-heading" className="font-semibold text-brand-teal">
        Delete account
      </h2>
      <p className="mt-1 text-sm text-text-muted">
        Permanently remove your account and everything we hold about you. This can&apos;t be
        undone.
      </p>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 rounded-xl border border-brand-coral px-4 py-2 text-sm font-semibold text-brand-coral-ink transition hover:bg-brand-coral hover:text-white"
        >
          Delete my account
        </button>
      ) : (
        <form onSubmit={onDelete} className="mt-4 space-y-3">
          <div className="rounded-xl bg-surface-alt p-4 text-sm text-text-muted">
            <p className="font-semibold text-foreground">This will delete:</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5">
              <li>Your profile, photo and sign-in details</li>
              <li>Trips you created, with their plans, budgets and group chat</li>
              <li>Your messages, reviews, saved places and travel buddies</li>
            </ul>
            <p className="mt-2">
              You&apos;ll be removed from trips other people created, but those trips stay.
            </p>
          </div>
          <label className="block text-sm text-text-muted">
            Type <strong className="text-foreground">{CONFIRM_WORD}</strong> to confirm
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="mt-1.5 block w-full max-w-xs rounded-xl border border-line-input bg-white px-3 py-2 text-sm text-foreground focus:border-brand-teal focus:outline-none"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm font-semibold text-brand-coral-ink">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={typed !== CONFIRM_WORD || deleting}
              className="rounded-xl bg-brand-coral px-4 py-2 text-sm font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Delete my account permanently"}
            </button>
            <button
              type="button"
              onClick={close}
              disabled={deleting}
              className="rounded-xl border border-line-input bg-white px-4 py-2 text-sm font-semibold text-text-muted transition hover:border-brand-teal hover:text-brand-teal"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
