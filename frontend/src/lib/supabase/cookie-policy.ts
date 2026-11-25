import type { CookieOptions } from "@supabase/ssr";

/**
 * How long the Supabase session cookie lives.
 *
 * Supabase's library always writes its auth cookies with a 400-day lifetime.
 * We shorten that to 7 days unless the person ticked "Remember me" at login.
 * Every time the session refreshes (about hourly while the site is in use)
 * the cookie is written again, so an active user's 7 days keep rolling
 * forward; a forgotten session on a shared computer dies within a week.
 *
 * The cookie stays readable by page scripts (httpOnly: false) because the
 * browser half of Supabase needs it; the CSP in proxy.ts is what keeps
 * injected scripts from running to read it.
 */

/** Set at login when "Remember me" is ticked; holds no personal data. */
export const REMEMBER_COOKIE = "tb-remember";

const DAY = 24 * 60 * 60;
export const REMEMBERED_SESSION_SECONDS = 400 * DAY;
export const SHORT_SESSION_SECONDS = 7 * DAY;

/** Secure (HTTPS-only) cookies wherever the site itself is served over HTTPS. */
export const SECURE_COOKIES = (process.env.NEXT_PUBLIC_SITE_URL ?? "").startsWith("https://");

/**
 * Adjust the options Supabase asked for on one auth cookie. Deletions
 * (maxAge 0) pass through untouched so sign-out still clears everything.
 */
export function authCookieOptions(options: CookieOptions, remembered: boolean): CookieOptions {
  const next: CookieOptions = {
    ...options,
    path: "/",
    sameSite: "lax",
    secure: SECURE_COOKIES || options.secure,
  };
  if (options.maxAge !== 0) {
    next.maxAge = remembered ? REMEMBERED_SESSION_SECONDS : SHORT_SESSION_SECONDS;
  }
  return next;
}

/** Options for the "Remember me" cookie itself (set, or cleared with remember=false). */
export function rememberCookieOptions(remember: boolean): CookieOptions {
  return {
    path: "/",
    sameSite: "lax",
    secure: SECURE_COOKIES,
    maxAge: remember ? REMEMBERED_SESSION_SECONDS : 0,
  };
}
