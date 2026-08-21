"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { registerSchema } from "@/lib/schemas";
import { Button, FormError, FormSuccess, Input } from "@/components/ui";

export default function RegisterPage() {
  const router = useRouter();
  const [values, setValues] = useState({
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [loading, setLoading] = useState(false);

  function set(name: string, value: string) {
    setValues((v) => ({ ...v, [name]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setErrors({});

    const parsed = registerSchema.safeParse(values);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        fieldErrors[String(issue.path[0])] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
      },
    });
    setLoading(false);

    if (error) {
      setFormError(error.message);
      return;
    }

    // If email confirmation is on, there is no session yet.
    if (!data.session) {
      setNeedsConfirmation(true);
      return;
    }
    router.push("/onboarding");
    router.refresh();
  }

  if (needsConfirmation) {
    return (
      <section className="space-y-4">
        <h1 className="text-[28px] leading-none">Check your email</h1>
        <FormSuccess
          message={`We sent a confirmation link to ${values.email}. Click it to activate your account, then sign in.`}
        />
        <Link href="/login" className="block text-center text-sm font-bold text-brand-coral-ink">
          Back to sign in
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-[28px] leading-none">Create your account</h1>
        <p className="mt-1 text-sm text-text-subtle">Start planning your next trip.</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError message={formError} />
        <Input
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          value={values.email}
          onChange={(e) => set("email", e.target.value)}
          error={errors.email}
          required
        />
        <Input
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={values.password}
          onChange={(e) => set("password", e.target.value)}
          error={errors.password}
          required
        />
        <Input
          label="Confirm password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          value={values.confirmPassword}
          onChange={(e) => set("confirmPassword", e.target.value)}
          error={errors.confirmPassword}
          required
        />
        <Button variant="coral" type="submit" loading={loading}>
          Create account
        </Button>
      </form>
      <p className="text-center text-sm text-text-subtle">
        Already have an account?{" "}
        <Link href="/login" className="font-bold text-brand-coral-ink">
          Sign in
        </Link>
      </p>
    </section>
  );
}
