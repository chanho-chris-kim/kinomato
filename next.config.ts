import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;

// Makes `next dev` proxy through the Cloudflare Workers runtime (bindings,
// wrangler-sourced env) instead of plain Node — only active outside
// production, per OpenNext Cloudflare's own guidance.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
