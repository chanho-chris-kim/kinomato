import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No incremental-cache override (e.g. R2) yet — every route is dynamic
// (a session cookie read, request params, or a dynamic segment), so
// there's nothing to cache. Add one (see the OpenNext Cloudflare caching
// docs) if/when a static or ISR route shows up.
export default defineCloudflareConfig();
