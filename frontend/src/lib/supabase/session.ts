import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { authCookieOptions, REMEMBER_COOKIE } from "@/lib/supabase/cookie-policy";

/**
 * Refreshes the Supabase auth session on every request and guards private
 * routes. Kept in its own file so `src/middleware.ts` stays a thin entry point.
 */
export async function updateSession(
  request: NextRequest,
  /** Extra request headers for the render (the CSP nonce, see proxy.ts). */
  extraHeaders: Record<string, string> = {},
) {
  // Built fresh each time: refreshed cookies are written onto `request`, and
  // the render must see them along with the extra headers.
  const forwarded = () => {
    const headers = new Headers(request.headers);
    for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
    return NextResponse.next({ request: { headers } });
  };
  const remembered = request.cookies.get(REMEMBER_COOKIE)?.value === "1";
  let response = forwarded();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = forwarded();
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, authCookieOptions(options, remembered)),
          );
        },
      },
    },
  );

  // getClaims() verifies the JWT signature locally against Supabase's cached
  // public keys (and still refreshes an expired session), so route guarding
  // costs no network round trip. getUser() here hit the Supabase Auth server on
  // every navigation *and* every prefetch — the biggest source of page-load lag.
  // Do not trust getSession() for authorization decisions.
  const {
    data: claims,
  } = await supabase.auth.getClaims();
  const user = claims?.claims ?? null;

  const { pathname } = request.nextUrl;
  const isAuthRoute =
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/update-password") ||
    pathname.startsWith("/auth");

  // Unauthenticated users may only reach auth routes, the landing page and
  // the cookies & privacy page.
  if (!user && !isAuthRoute && pathname !== "/" && pathname !== "/privacy") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Signed-in users have no reason to see login/register again.
  if (user && (pathname.startsWith("/login") || pathname.startsWith("/register"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/profile";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
