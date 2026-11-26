// Where to go after signing in. `next` comes from the address bar, so anyone can
// set it: only paths inside this app are allowed (no open redirect).
const BASE = "https://app.invalid";

export function safeNextPath(next: string | null, fallback = "/profile"): string {
  if (!next || !next.startsWith("/")) return fallback;
  try {
    // Parsing the way a browser does also catches tricks like "/\\evil.com".
    const url = new URL(next, BASE);
    const path = url.pathname + url.search + url.hash;
    return url.origin === BASE && !path.startsWith("//") ? path : fallback;
  } catch {
    return fallback;
  }
}
