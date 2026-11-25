import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { authCookieOptions, REMEMBER_COOKIE } from "@/lib/supabase/cookie-policy";

/**
 * Supabase client for Server Components, Route Handlers and middleware.
 *
 * Reads the session from cookies so server code can know who is signed in
 * (e.g. to guard a route). Still only uses the public anon key. Cookie
 * lifetimes follow the "Remember me" choice — see cookie-policy.ts.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const remembered = cookieStore.get(REMEMBER_COOKIE)?.value === "1";

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, authCookieOptions(options, remembered)),
            );
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // The middleware refreshes the session, so this is safe to ignore.
          }
        },
      },
    },
  );
}
