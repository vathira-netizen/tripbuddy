import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";

/**
 * Handles the redirect target of Supabase email links (sign-up confirmation and
 * password reset). Supabase's PKCE flow puts a `code` on the URL; we exchange
 * it for a session cookie here, then send the user on to `next`.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // No code, or the exchange failed — bounce to login with a hint.
  return NextResponse.redirect(`${origin}/login?error=auth_callback`);
}
