import { z } from "zod";

import {
  AGE_BANDS,
  BUDGET_STYLES,
  GENDERS,
  INTEREST_TAGS,
  LANGUAGES,
} from "@/lib/vocab";

export const emailSchema = z.string().trim().email("Enter a valid email address.");

// Mirrors Supabase's default minimum; the backend never sees the password.
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.");

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
