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
import PhoneVerify from "@/components/PhoneVerify";

const STEPS = ["About you", "Preferences", "Where you're based", "Verify your phone"];
// The first three steps make up the profile form; the phone step comes after
// the profile is saved and can be skipped (it's needed only for buddy features).
const PROFILE_STEPS = 3;

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
      setStep(PROFILE_STEPS);
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

  function finish() {
    router.push("/discover?welcome=1");
    router.refresh();
  }

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-10">
      <h1 className="text-3xl tracking-tight">Set up your travel profile</h1>

      <ol className="mt-4 flex gap-2" aria-label="Onboarding progress">
        {STEPS.map((label, i) => (
          <li key={label} className="flex-1">
            <div
              aria-current={i === step ? "step" : undefined}
              className={`h-1.5 rounded-full ${i <= step ? "bg-brand-teal" : "bg-[#dcdcd3]"}`}
            />
            <span
              className={`mt-1 block text-xs ${
                i === step ? "font-bold text-brand-teal" : "text-text-subtle"
              }`}
            >
              {label}
            </span>
          </li>
        ))}
      </ol>

      {step === PROFILE_STEPS && (
        <section aria-labelledby="verify-phone-heading" className="mt-6 space-y-5">
          <div>
            <h2 id="verify-phone-heading" className="text-xl tracking-tight">
              Verify your phone
            </h2>
            <p className="mt-1 text-sm text-text-subtle">
              Your profile is saved. To find travel buddies and message them, verify
              your mobile number. Browsing destinations and planning your own trips
              work without it.
            </p>
          </div>
          <PhoneVerify onVerified={finish} />
          <button
            type="button"
            onClick={finish}
            className="w-full text-center text-sm font-semibold text-text-subtle underline hover:text-brand-teal"
          >
            Skip for now
          </button>
        </section>
      )}

      {step < PROFILE_STEPS && (
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
              <p className="text-xs text-text-subtle">
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
                className="w-full rounded-full border border-[#c2c8c0] px-4 py-2.5 text-sm font-bold text-brand-teal transition hover:border-brand-teal hover:bg-surface-alt"
              >
                Back
              </button>
            )}
            {step < PROFILE_STEPS - 1 ? (
              <Button variant="coral" type="button" onClick={() => setStep((s) => s + 1)}>
                Continue
              </Button>
            ) : (
              <Button variant="coral" type="submit" loading={loading}>
                Save and continue
              </Button>
            )}
          </div>
        </form>
      )}
    </main>
  );
}
