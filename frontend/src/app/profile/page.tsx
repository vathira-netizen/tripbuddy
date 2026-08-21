"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { api, ApiError } from "@/lib/api";
import { profileEditSchema, type Profile } from "@/lib/schemas";
import { Button, FormError, FormSuccess, Input } from "@/components/ui";
import { SignOutButton } from "@/components/SignOutButton";
import {
  applyFieldUpdate,
  IdentityFields,
  PreferenceFields,
  type FieldSetter,
  type ProfileFieldValues,
} from "@/components/ProfileFields";

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [values, setValues] = useState<ProfileFieldValues | null>(null);
  // Blank means "keep my current area"; typing a city re-geocodes it.
  const [city, setCity] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<Profile>("/api/profile/me/")
      .then((p) => {
        if (!p.onboarded) {
          router.replace("/onboarding");
          return;
        }
        setProfile(p);
        setValues({
          display_name: p.display_name,
          age_band: p.age_band,
          gender: p.gender,
          languages: p.languages,
          interests: p.interests,
          budget_style: p.budget_style,
          daily_budget: p.daily_budget == null ? "" : String(p.daily_budget),
        });
      })
      .catch(() => setFormError("Could not load your profile."))
      .finally(() => setLoading(false));
  }, [router]);

  const set: FieldSetter = (key, value) => {
    setValues((v) => (v ? applyFieldUpdate(v, key, value) : v));
    setSaved(false);
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!values) return;
    setFormError(null);
    setErrors({});
    setSaved(false);

    const parsed = profileEditSchema.safeParse({
      ...values,
      daily_budget: values.daily_budget === "" ? NaN : Number(values.daily_budget),
      city,
    });
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        fieldErrors[String(issue.path[0])] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    // Don't send an empty city — that would be a no-op round trip to the geocoder.
    const { city: submittedCity, ...rest } = parsed.data;
    const payload = submittedCity ? { ...rest, city: submittedCity } : rest;

    setSaving(true);
    try {
      const updated = await api.patch<Profile>("/api/profile/me/", payload);
      setProfile(updated);
      setCity("");
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError) {
        const data = err.data as Record<string, string[]> | undefined;
        if (data?.city) {
          setErrors((e) => ({ ...e, city: data.city[0] }));
        } else {
          setFormError("Could not save changes. Please check your entries.");
        }
      } else {
        setFormError("Network error. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-lg px-4 py-10 text-sm text-text-subtle">
        Loading…
      </main>
    );
  }
  if (!values || !profile) {
    return (
      <main className="mx-auto max-w-lg px-4 py-10">
        <FormError message={formError ?? "Profile unavailable."} />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl tracking-tight">Your profile</h1>
        <SignOutButton />
      </div>
      <p className="mt-1 text-sm text-text-subtle">
        {profile.email}
        {profile.area_label ? ` · ${profile.area_label}` : ""}
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-5" noValidate>
        <FormError message={formError} />
        <FormSuccess message={saved ? "Profile saved." : null} />
        <IdentityFields values={values} errors={errors} set={set} />
        <PreferenceFields values={values} errors={errors} set={set} />

        <div className="space-y-1 border-t border-line pt-5">
          <Input
            label="Change your city"
            name="city"
            placeholder={profile.area_label || "e.g. Bengaluru"}
            value={city}
            onChange={(e) => setCity(e.target.value)}
            error={errors.city}
          />
          <p className="text-xs text-text-subtle">
            {profile.area_label
              ? `Currently: ${profile.area_label}. `
              : ""}
            Leave blank to keep it. We store only an approximate point for your
            city — never your exact location.
          </p>
        </div>

        <Button variant="coral" type="submit" loading={saving}>
          Save changes
        </Button>
      </form>
    </main>
  );
}
