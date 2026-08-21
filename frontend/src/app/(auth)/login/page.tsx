"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { loginSchema } from "@/lib/schemas";
import { Button, FormError, Input } from "@/components/ui";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginFallback() {
  return (
    <section className="space-y-1">
      <h1 className="text-[28px] leading-none">Welcome back</h1>
      <p className="text-sm text-text-subtle">Loading…</p>
    </section>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/profile";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setErrors({});

    const parsed = loginSchema.safeParse({ email, password });
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
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    setLoading(false);

    if (error) {
      setFormError(error.message);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-[28px] leading-none">Welcome back</h1>
        <p className="mt-1 text-sm text-text-subtle">Sign in to plan your next trip.</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError message={formError} />
        <Input
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          required
        />
        <Input
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          required
        />
        <div className="text-right text-sm">
          <Link href="/reset-password" className="font-bold text-brand-coral-ink">
            Forgot password?
          </Link>
        </div>
        <Button variant="coral" type="submit" loading={loading}>
          Sign in
        </Button>
      </form>
      <p className="text-center text-sm text-text-subtle">
        New here?{" "}
        <Link href="/register" className="font-bold text-brand-coral-ink">
          Create an account
        </Link>
      </p>
    </section>
  );
}
