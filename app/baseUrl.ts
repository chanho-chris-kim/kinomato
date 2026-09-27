import { headers } from "next/headers";

// Cloudflare sets x-forwarded-proto; localhost has no forwarding at all,
// so it falls back to http. Derived per request rather than a hardcoded
// domain env var — this app has two deployments (dev.kinomato.com and
// per-branch *.workers.dev previews, CLAUDE.md) plus local dev, and a
// link in an email or an invite has to point back at whichever one
// issued it.
export async function getBaseUrl(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host");
  return `${proto}://${host}`;
}

// Only ever a same-origin path: `next`/`returnTo` values come from query
// strings, and following an absolute or protocol-relative URL would make
// the app an open redirect (docs/onboarding-spec.md §5.1).
export function safePath(value: string | null | undefined, fallback = "/"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return fallback;
  }
  return value;
}
