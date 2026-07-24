"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { api, ApiError } from "@/lib/api";
import { onboardingSchema } from "@/lib/schemas";
import type { Profile } from "@/lib/schemas";
import { Button, FormError, Input } from "@/components/ui";
import {
  applyFieldUpdate,
  emptyProfileFields,
  IdentityFields,
  PreferenceFields,
  type FieldSetter,
  type ProfileFieldValues,
} from "@/components/ProfileFields";

const STEPS = ["About you", "Preferences", "Where you're based"];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<ProfileFieldValues>(emptyProfileFields);
  const [city, setCity] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const set: FieldSetter = (key, value) => {
    setValues((v) => applyFieldUpdate(v, key, value));
  };

  function buildPayload() {
    return {
      display_name: values.display_name,
      age_band: values.age_band,
      gender: values.gender,
      languages: values.languages,
      interests: values.interests,
      budget_style: values.budget_style,
      daily_budget: values.daily_budget === "" ? NaN : Number(values.daily_budget),
      city,
    };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setErrors({});

    const parsed = onboardingSchema.safeParse(buildPayload());
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        fieldErrors[String(issue.path[0])] = issue.message;
      }
      setErrors(fieldErrors);
      // Jump back to the first step that has an error.
      if (["display_name", "age_band", "gender"].some((f) => fieldErrors[f])) {
        setStep(0);
      } else if (
        ["languages", "interests", "budget_style", "daily_budget"].some(
          (f) => fieldErrors[f],
        )
      ) {
        setStep(1);
      }
      return;
    }

    setLoading(true);
    try {
      await api.post<Profile>("/api/profile/onboarding/", parsed.data);
      router.push("/profile");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        const data = err.data as Record<string, string[]> | undefined;
        if (data?.city) {
          setErrors((e) => ({ ...e, city: data.city[0] }));
        } else {
          setFormError("Could not save your profile. Please check your entries.");
        }
      } else {
        setFormError("Network error. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-10">
      <h1 className="text-xl font-semibold">Set up your travel profile</h1>

      <ol className="mt-4 flex gap-2" aria-label="Onboarding progress">
        {STEPS.map((label, i) => (
          <li key={label} className="flex-1">
            <div
              aria-current={i === step ? "step" : undefined}
              className={`h-1.5 rounded-full ${
                i <= step ? "bg-indigo-600" : "bg-black/10 dark:bg-white/15"
              }`}
            />
            <span className="mt-1 block text-xs text-black/60 dark:text-white/60">
              {label}
            </span>
          </li>
        ))}
      </ol>

      <form onSubmit={onSubmit} className="mt-6 space-y-5" noValidate>
        <FormError message={formError} />

        {step === 0 && (
          <div className="space-y-4">
            <IdentityFields values={values} errors={errors} set={set} />
          </div>
        )}
        {step === 1 && (
          <div className="space-y-4">
            <PreferenceFields values={values} errors={errors} set={set} />
          </div>
        )}
        {step === 2 && (
          <div className="space-y-4">
            <Input
              label="Your city"
              name="city"
              placeholder="e.g. Bengaluru"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              error={errors.city}
              required
            />
            <p className="text-xs text-black/60 dark:text-white/60">
              We store only an approximate point for your city to find nearby
              buddies. Your exact location is never saved or shared.
            </p>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              className="w-full rounded-lg border border-black/15 px-4 py-2.5 text-sm font-semibold transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              Back
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={() => setStep((s) => s + 1)}>
              Continue
            </Button>
          ) : (
            <Button type="submit" loading={loading}>
              Finish
            </Button>
          )}
        </div>
      </form>
    </main>
  );
}
