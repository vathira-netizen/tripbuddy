"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { updatePasswordSchema } from "@/lib/schemas";
import { Button, FormError, Input } from "@/components/ui";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [values, setValues] = useState({ password: "", confirmPassword: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);

  // The reset link (via /auth/callback) establishes a recovery session; confirm
  // it exists so the user isn't told to reset from a dead link.
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        setFormError(
          "This reset link is invalid or has expired. Request a new one from the sign-in page.",
        );
      }
      setReady(true);
    });
  }, []);

  function set(name: string, value: string) {
    setValues((v) => ({ ...v, [name]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setErrors({});

    const parsed = updatePasswordSchema.safeParse(values);
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
    const { error } = await supabase.auth.updateUser({
      password: parsed.data.password,
    });
    setLoading(false);

    if (error) {
      setFormError(error.message);
      return;
    }
    router.push("/profile");
    router.refresh();
  }

  return (
    <section className="space-y-5 rounded-2xl border border-black/10 p-6 dark:border-white/15">
      <h1 className="text-lg font-semibold">Choose a new password</h1>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError message={formError} />
        <Input
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={values.password}
          onChange={(e) => set("password", e.target.value)}
          error={errors.password}
          required
        />
        <Input
          label="Confirm new password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          value={values.confirmPassword}
          onChange={(e) => set("confirmPassword", e.target.value)}
          error={errors.confirmPassword}
          required
        />
        <Button type="submit" loading={loading} disabled={!ready}>
          Update password
        </Button>
      </form>
    </section>
  );
}
