import { createBrowserClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";

import {
  authCookieOptions,
  REMEMBER_COOKIE,
  rememberCookieOptions,
} from "@/lib/supabase/cookie-policy";

function isRemembered(): boolean {
  return parseCookieHeader(document.cookie).some(
    (c) => c.name === REMEMBER_COOKIE && c.value === "1",
  );
}

/**
 * Supabase client for use in Client Components (browser).
 *
 * Only ever reads NEXT_PUBLIC_* values — the anon key is designed to be public.
 * The service-role key and JWT secret are backend-only and must never appear
 * here or anywhere in the client bundle.
 *
 * Cookies go through our own getAll/setAll so their lifetime follows the
 * "Remember me" choice (see cookie-policy.ts) instead of the library's fixed
 * 400 days.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          if (typeof document === "undefined") return [];
          return parseCookieHeader(document.cookie).map(({ name, value }) => ({
            name,
            value: value ?? "",
          }));
        },
        setAll(cookiesToSet) {
          if (typeof document === "undefined") return;
          const remembered = isRemembered();
          cookiesToSet.forEach(({ name, value, options }) => {
            document.cookie = serializeCookieHeader(
              name,
              value,
              authCookieOptions(options, remembered),
            );
          });
        },
      },
    },
  );
}

/**
 * Record the "Remember me" choice. Call it *before* signing in, so the very
 * first session cookie is written with the right lifetime; call it with false
 * on sign-out so the next person on this browser starts with a short session.
 */
export function setRememberMe(remember: boolean) {
  if (typeof document === "undefined") return;
  document.cookie = serializeCookieHeader(
    REMEMBER_COOKIE,
    remember ? "1" : "",
    rememberCookieOptions(remember),
  );
}
