import { z } from "zod";

import {
  AGE_BANDS,
  BUDGET_STYLES,
  GENDERS,
  INTEREST_TAGS,
  LANGUAGES,
} from "@/lib/vocab";

// Our Content-Security-Policy forbids eval; without this Zod probes for it
// with `new Function`, which the browser reports as a CSP violation.
z.config({ jitless: true });

export const emailSchema = z.string().trim().email("Enter a valid email address.");

// New passwords only (sign-up, reset). Raise Supabase's own minimum to match
// under Authentication → Sign In / Providers → Email ("Minimum password
// length"), or Supabase itself would still accept 8.
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(72, "Use at most 72 characters.");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const resetRequestSchema = z.object({ email: emailSchema });
export type ResetRequestInput = z.infer<typeof resetRequestSchema>;

export const updatePasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;

const ageBand = z.enum(AGE_BANDS);
const gender = z.enum(GENDERS.map((g) => g.value) as [string, ...string[]]);
const budgetStyle = z.enum(
  BUDGET_STYLES.map((b) => b.value) as [string, ...string[]],
);
const interest = z.enum(INTEREST_TAGS);
const language = z.enum(LANGUAGES);

export const onboardingSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(2, "Tell us what to call you.")
    .max(60),
  age_band: ageBand,
  gender,
  languages: z
    .array(language)
    .min(1, "Pick at least one language.")
    .max(8, "Pick up to 8 languages."),
  interests: z
    .array(interest)
    .min(1, "Pick at least one interest.")
    .max(10, "Pick up to 10 interests."),
  budget_style: budgetStyle,
  daily_budget: z
    .number({ message: "Enter a daily budget." })
    .int()
    .min(0)
    .max(1_000_000),
  city: z.string().trim().min(2, "Enter your city."),
});
export type OnboardingInput = z.infer<typeof onboardingSchema>;

// Profile edit reuses the onboarding fields, but the city is optional: leave it
// blank to keep your current area, or type a new city to have it re-geocoded.
export const profileEditSchema = onboardingSchema.omit({ city: true }).extend({
  city: z
    .union([z.literal(""), z.string().trim().min(2, "Enter a valid city.")])
    .optional(),
});
export type ProfileEditInput = z.infer<typeof profileEditSchema>;

export type Profile = {
  supabase_user_id: string;
  email: string;
  display_name: string;
  avatar_url: string;
  bio: string;
  travel_styles: string[];
  upi_vpa: string;
  email_verified: boolean;
  phone_verified: boolean;
  completeness: { percent: number; missing: string[] };
  age_band: string;
  gender: string;
  languages: string[];
  interests: string[];
  budget_style: string;
  daily_budget: number | null;
  area_label: string;
  area: { lat: number; lng: number } | null;
  onboarded: boolean;
};

// --- Shared helpers ------------------------------------------------------------

/** Zod issues → { field: first message }, for a form's inline errors. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

/** A DRF 400 body ({ field: ["msg"] }) → { field: "msg" }, so the server's
 *  verdict shows next to the same field the browser checks. */
export function serverFieldErrors(data: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const msg = Array.isArray(value) ? value[0] : value;
      if (typeof msg === "string") out[key === "non_field_errors" ? "form" : key] = msg;
    }
  }
  return out;
}

// These mirror the backend's rules (the backend has the final say); here they
// give instant feedback before anything is sent.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const optionalDate = isoDate.or(z.literal(""));

export const MAX_BUDGET_AMOUNT = 1_000_000;

export const tripFormSchema = z
  .object({
    title: z.string().trim().min(1, "Give the trip a name.").max(120, "Keep the name under 120 characters."),
    start_date: optionalDate,
    end_date: optionalDate,
    target_amount: z
      .string()
      .refine((v) => v === "" || (Number(v) >= 0 && Number(v) <= 100_000_000), "Enter a budget of ₹0 or more."),
    join_deadline: optionalDate,
    today: isoDate,
  })
  .superRefine((t, ctx) => {
    if (t.start_date && t.start_date < t.today) {
      ctx.addIssue({ code: "custom", path: ["start_date"], message: "Pick today or a later date." });
    }
    if (t.start_date && t.end_date && t.end_date < t.start_date) {
      ctx.addIssue({ code: "custom", path: ["end_date"], message: "The trip can't end before it starts." });
    }
    if (t.join_deadline && t.join_deadline < t.today) {
      ctx.addIssue({ code: "custom", path: ["join_deadline"], message: "The deadline can't be in the past." });
    }
    if (t.join_deadline && t.start_date && t.join_deadline > t.start_date) {
      ctx.addIssue({ code: "custom", path: ["join_deadline"], message: "Set it on or before the start date." });
    }
  });

export const budgetItemSchema = z.object({
  label: z.string().trim().min(1, "Say what this was for.").max(200, "Keep it under 200 characters."),
  amount: z
    .string()
    .trim()
    .min(1, "Enter an amount.")
    .refine((v) => Number(v) > 0, "Enter an amount above ₹0.")
    .refine((v) => Number(v) <= MAX_BUDGET_AMOUNT, "That's more than ₹10,00,000 — check the amount."),
});

export const REVIEW_MAX = 1000;
export const reviewSchema = z.object({
  rating: z.number().int().min(1, "Pick a star rating.").max(5),
  body: z.string().trim().max(REVIEW_MAX, `Keep reviews under ${REVIEW_MAX} characters.`),
});

export const ITINERARY_NOTES_MAX = 2000;
export const itineraryItemSchema = z.object({
  title: z.string().trim().min(1, "Give the item a name.").max(200, "Keep it under 200 characters."),
  notes: z.string().max(ITINERARY_NOTES_MAX, `Keep notes under ${ITINERARY_NOTES_MAX} characters.`),
});

export const placeQuerySchema = z
  .string()
  .trim()
  .min(2, "Type at least 2 letters.")
  .max(120, "That's too long for a place name.");

// --- Phone verification ---------------------------------------------------------
// India only for now. Indian mobile numbers are 10 digits starting 6-9; people
// write them with or without +91, 0091, 91 or a leading 0, and with spaces,
// dashes, dots or brackets.

const INDIAN_MOBILE = /^(?:\+91|0091|91|0)?([6-9]\d{9})$/;

/** `+91` followed by the 10 digits, or `null` if it isn't an Indian mobile number. */
export function normaliseIndianPhone(input: string): string | null {
  const compact = input.trim().replace(/[\s\-().]/g, "");
  const match = INDIAN_MOBILE.exec(compact);
  return match ? `+91${match[1]}` : null;
}

export const PHONE_ERROR = "Enter an Indian mobile number: 10 digits, starting 6, 7, 8 or 9.";

/** Parses to the E.164 form Supabase expects, e.g. "+919876543210". */
export const phoneSchema = z
  .string()
  .trim()
  .min(1, "Enter your mobile number.")
  .transform((value, ctx) => {
    const e164 = normaliseIndianPhone(value);
    if (!e164) {
      ctx.addIssue({ code: "custom", message: PHONE_ERROR });
      return z.NEVER;
    }
    return e164;
  });

export const OTP_LENGTH = 6;
export const otpSchema = z
  .string()
  .trim()
  .regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), `Enter the ${OTP_LENGTH}-digit code from the SMS.`);
