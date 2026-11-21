"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { profileEditSchema, type Profile } from "@/lib/schemas";
import { TRAVEL_STYLES } from "@/lib/vocab";
import { Button, FormError, FormSuccess, Input, TagPicker } from "@/components/ui";
import AvatarUpload from "@/components/AvatarUpload";
import ProfileCompletenessMeter from "@/components/ProfileCompletenessMeter";
import ProfileView from "@/components/ProfileView";
import {
  applyFieldUpdate,
  IdentityFields,
  PreferenceFields,
  type FieldSetter,
  type ProfileFieldValues,
} from "@/components/ProfileFields";

const BIO_MAX = 280;

export default function ProfilePage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-text-subtle">Loading…</p>}>
      <ProfileInner />
    </Suspense>
  );
}

/** View mode by default; `?edit=1` is the edit form (so Back returns to the view). */
function ProfileInner() {
  const router = useRouter();
  const editing = useSearchParams().get("edit") === "1";
  const [profile, setProfile] = useState<Profile | null>(null);
  const [values, setValues] = useState<ProfileFieldValues | null>(null);
  const [bio, setBio] = useState("");
  const [travelStyles, setTravelStyles] = useState<string[]>([]);
  const [upiVpa, setUpiVpa] = useState("");
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
        setBio(p.bio);
        setTravelStyles(p.travel_styles);
        setUpiVpa(p.upi_vpa);
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
    const payload = {
      ...rest,
      ...(submittedCity ? { city: submittedCity } : {}),
      bio,
      travel_styles: travelStyles,
      upi_vpa: upiVpa,
    };

    setSaving(true);
    try {
      const updated = await api.patch<Profile>("/api/profile/me/", payload);
      setProfile(updated);
      setCity("");
      setSaved(true);
      toast.success("Profile saved");
      router.push("/profile");
    } catch (err) {
      if (err instanceof ApiError) {
        const data = err.data as Record<string, string[]> | undefined;
        if (data?.city || data?.upi_vpa) {
          setErrors((e) => ({
            ...e,
            ...(data.city ? { city: data.city[0] } : {}),
            ...(data.upi_vpa ? { upi_vpa: data.upi_vpa[0] } : {}),
          }));
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

  if (!editing) {
    return <ProfileView profile={profile} onEdit={() => router.push("/profile?edit=1")} />;
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => router.push("/profile")}
          aria-label="Back to your profile"
          className="grid h-9 w-9 place-items-center rounded-full border border-line-input bg-white text-brand-teal transition hover:border-brand-teal"
        >
          ←
        </button>
        <div>
          <h1 className="font-serif text-3xl leading-none tracking-tight text-brand-teal">
            Edit profile
          </h1>
          <p className="mt-1 text-sm text-text-subtle">{profile.email}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="h-fit space-y-5 rounded-[20px] border border-line bg-surface p-5 lg:sticky lg:top-24">
        <AvatarUpload
          supabaseUserId={profile.supabase_user_id}
          displayName={values.display_name}
          avatarUrl={profile.avatar_url}
          onUploaded={(avatar_url) => setProfile((p) => (p ? { ...p, avatar_url } : p))}
        />
        <ProfileCompletenessMeter
          values={{
            avatar_url: profile.avatar_url,
            bio,
            travel_styles: travelStyles,
            languages: values.languages,
            interests: values.interests,
            daily_budget: values.daily_budget,
            upi_vpa: upiVpa,
          }}
        />
      </aside>

      <form
        onSubmit={onSubmit}
        className="space-y-5 rounded-[20px] border border-line bg-surface p-5 sm:p-6"
        noValidate
      >
        <FormError message={formError} />
        <FormSuccess message={saved ? "Profile saved." : null} />
        <IdentityFields values={values} errors={errors} set={set} />

        <div className="space-y-1">
          <label htmlFor="bio" className="block text-xs text-text-subtle">
            Travel bio
          </label>
          <textarea
            id="bio"
            name="bio"
            rows={3}
            maxLength={BIO_MAX}
            value={bio}
            onChange={(e) => {
              setBio(e.target.value);
              setSaved(false);
            }}
            placeholder="A line or two about how you like to travel…"
            className="w-full rounded-xl border border-line-input bg-white px-3.5 py-2.5 text-sm shadow-sm outline-none transition focus:border-brand-coral focus:ring-2 focus:ring-brand-coral/30"
          />
          <p className="text-right text-xs text-text-subtle">
            {bio.length}/{BIO_MAX}
          </p>
        </div>

        <TagPicker
          legend="Travel style"
          options={TRAVEL_STYLES}
          selected={travelStyles}
          onToggle={(v) => {
            setTravelStyles((prev) =>
              prev.includes(v) ? prev.filter((s) => s !== v) : [...prev, v],
            );
            setSaved(false);
          }}
        />

        <Input
          label="UPI ID (for settling trip expenses)"
          name="upi_vpa"
          value={upiVpa}
          onChange={(e) => {
            setUpiVpa(e.target.value);
            setSaved(false);
          }}
          placeholder="yourname@bank"
          error={errors.upi_vpa}
        />

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

        <div className="flex gap-3 border-t border-line pt-5">
          <button
            type="button"
            onClick={() => router.push("/profile")}
            className="rounded-full border border-line-input px-6 py-2.5 text-sm font-semibold text-text-muted transition hover:border-brand-teal hover:text-brand-teal"
          >
            Cancel
          </button>
          <Button variant="coral" type="submit" loading={saving} className="flex-1">
            Save changes
          </Button>
        </div>
      </form>
      </div>
    </main>
  );
}
