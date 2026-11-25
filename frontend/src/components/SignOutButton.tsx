"use client";

import { useRouter } from "next/navigation";
import { createClient, setRememberMe } from "@/lib/supabase/client";

export function SignOutButton({ className }: { className?: string } = {}) {
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    setRememberMe(false);
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={signOut}
      className={
        className ??
        "rounded-lg border border-line-input px-3 py-1.5 text-sm font-medium transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
      }
    >
      Sign out
    </button>
  );
}
