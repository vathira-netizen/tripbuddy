"use client";

import { useState } from "react";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";
import { resetRequestSchema } from "@/lib/schemas";
import { Button, FormError, FormSuccess, Input } from "@/components/ui";

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldError(undefined);

    const parsed = resetRequestSchema.safeParse({ email });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message);
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/update-password`,
    });
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  }

  return (
    <section className="space-y-5 rounded-2xl border border-black/10 p-6 dark:border-white/15">
      <h1 className="text-lg font-semibold">Reset your password</h1>
      {sent ? (
        <FormSuccess message="If an account exists for that email, a password-reset link is on its way." />
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormError message={error} />
          <p className="text-sm text-black/60 dark:text-white/60">
            Enter your email and we&apos;ll send you a link to choose a new password.
          </p>
          <Input
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={fieldError}
            required
          />
          <Button type="submit" loading={loading}>
            Send reset link
          </Button>
        </form>
      )}
      <Link href="/login" className="block text-center text-sm text-indigo-600 hover:underline">
        Back to sign in
      </Link>
    </section>
  );
}
