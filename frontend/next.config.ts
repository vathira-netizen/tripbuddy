import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Destination catalogue images (seed data uses picsum.photos).
    remotePatterns: [new URL("https://picsum.photos/**")],
  },
};

export default nextConfig;
