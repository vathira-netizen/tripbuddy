import { type NextRequest } from "next/server";
import { SECURE_COOKIES } from "@/lib/supabase/cookie-policy";
import { updateSession } from "@/lib/supabase/session";

const origin = (url: string | undefined) => {
  try {
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
};

const API = origin(process.env.NEXT_PUBLIC_API_URL) || "https://tripbuddy-backend-1387.onrender.com";
const SUPABASE = origin(process.env.NEXT_PUBLIC_SUPABASE_URL);

/**
 * Content-Security-Policy with a fresh nonce per request: only scripts that
 * Next.js itself rendered (and the chunks they load) can run, so a script
 * injected into a page is refused. Images and network calls are limited to
 * the services TripBuddy actually uses. Styles stay 'unsafe-inline' because
 * server-rendered style attributes and the map need it.
 */
function contentSecurityPolicy(nonce: string) {
  const isDev = process.env.NODE_ENV === "development";
  const images = [
    "'self'",
    "data:",
    "blob:",
    "https://*.supabase.co", // avatars and trip covers
    "https://images.unsplash.com", // sample travellers
    "https://randomuser.me",
    "https://*.wikimedia.org", // destination photos
    "https://picsum.photos",
    "https://tile.openstreetmap.org", // map tiles
    "https://*.tile.openstreetmap.org",
    "https://api.qrserver.com", // UPI settle-up QR codes
  ];
  const connect = [
    "'self'",
    API,
    SUPABASE,
    SUPABASE.replace(/^https:/, "wss:"), // Realtime chat
    ...(isDev ? ["ws:", "http://localhost:*"] : []),
  ].filter(Boolean);
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${images.join(" ")}`,
    "font-src 'self' data:",
    `connect-src ${connect.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Only when we're served over HTTPS: on a local http://localhost run it
    // would turn the http://localhost API calls into failing HTTPS ones.
    ...(SECURE_COOKIES ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce);
  // Next.js reads the nonce from the request's CSP header while rendering and
  // stamps it on its own <script> tags.
  const response = await updateSession(request, {
    "x-nonce": nonce,
    "Content-Security-Policy": csp,
  });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    /*
     * Run on every path except static assets and image files, so the session
     * cookie is kept fresh and route guards apply everywhere.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
