import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sent on every response. The Content-Security-Policy is per request (it
  // carries a nonce), so it lives in src/proxy.ts instead.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Location only for our own pages ("Use my current location").
          { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      // Legacy seed placeholders — picsum.photos is unreachable from this
      // environment, which is why cards showed broken images; kept for any
      // destination refresh_destination_images couldn't resolve.
      new URL("https://picsum.photos/**"),
      // Real destination photos, from the Wikipedia summary API.
      new URL("https://upload.wikimedia.org/**"),
      // User-uploaded avatars/trip covers, from Supabase Storage. Skipped when
      // the env var is absent (e.g. CI), where `new URL("undefined/…")` would
      // throw and fail the whole build.
      ...(process.env.NEXT_PUBLIC_SUPABASE_URL
        ? [new URL(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/**`)]
        : []),
    ],
  },
};

export default nextConfig;
