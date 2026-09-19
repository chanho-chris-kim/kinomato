import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Poster images (lib/tmdb.ts) — films.poster_path is a relative
    // TMDB path, resolved to a full URL at display time as
    // https://image.tmdb.org/t/p/{size}{poster_path}.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "image.tmdb.org",
        pathname: "/t/p/**",
      },
    ],
  },
};

export default nextConfig;

// Makes `next dev` proxy through the Cloudflare Workers runtime (bindings,
// wrangler-sourced env) instead of plain Node — only active outside
// production, per OpenNext Cloudflare's own guidance.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
