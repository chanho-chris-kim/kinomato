import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Metadata always in <head>, for every user agent. Next 16 streams
  // generateMetadata output into <body> for clients it doesn't recognize
  // as crawlers, and its list misses link previewers people use for
  // invites (Telegram, KakaoTalk, Signal, LINE, Viber); many only read
  // <head>. Our metadata is cheap (the request host, plus the invite
  // lookup the page makes anyway), so blocking on it costs little.
  htmlLimitedBots: /.*/,
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
