import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Legacy seed placeholders — picsum.photos is unreachable from this
      // environment, which is why cards showed broken images; kept for any
      // destination refresh_destination_images couldn't resolve.
      new URL("https://picsum.photos/**"),
      // Real destination photos, from the Wikipedia summary API.
      new URL("https://upload.wikimedia.org/**"),
      // User-uploaded avatars/trip covers, from Supabase Storage.
      new URL(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/**`),
    ],
  },
};

export default nextConfig;
