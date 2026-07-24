import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for use in Client Components (browser).
 *
 * Only ever reads NEXT_PUBLIC_* values — the anon key is designed to be public.
 * The service-role key and JWT secret are backend-only and must never appear
 * here or anywhere in the client bundle.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
