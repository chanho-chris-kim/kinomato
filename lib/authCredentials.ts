// Sign-in credentials (docs/onboarding-spec.md §4): a 6-digit code and a
// link token, issued together in one email and consumed together; plus the
// session token a successful sign-in produces. None of them is stored in
// the clear:
//
// - Link and session tokens are 128-bit random values, so a plain SHA-256
//   is enough — there's nothing to brute-force.
// - The code has only 10^6 values. A bare hash of it is cracked in
//   milliseconds by anyone who can read the table, so it's an HMAC keyed by
//   AUTH_SECRET, which lives in the environment, never the database.
//
// Pure apart from getAuthSecret's env read. node:crypto runs in the Worker
// under nodejs_compat (wrangler.jsonc).
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const CODE_MAX_ATTEMPTS = 5;
export const SEND_COOLDOWN_SECONDS = 30;
export const SENDS_PER_HOUR = 5;

const CODE_SPACE = 1_000_000;
// The largest multiple of 1e6 that fits in a uint32. Draws at or above it
// are redrawn: folding them down with % would make low codes likelier.
const UNBIASED_LIMIT = Math.floor(2 ** 32 / CODE_SPACE) * CODE_SPACE;

function randomUint32(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

export function generateSignInCode(nextUint32: () => number = randomUint32): string {
  let value = nextUint32();
  while (value >= UNBIASED_LIMIT) value = nextUint32();
  return String(value % CODE_SPACE).padStart(6, "0");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hashCode(code: string, secret: string): string {
  return createHmac("sha256", secret).update(code).digest("hex");
}

// People paste "123 456" or add a trailing space. Anything that isn't six
// digits once spaces are gone is simply wrong, not an error.
export function codeMatches(submitted: string, storedHash: string | null, secret: string): boolean {
  if (!storedHash) return false;
  const code = submitted.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) return false;
  const a = Buffer.from(hashCode(code, secret), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type SignInState = "usable" | "consumed" | "expired" | "locked";

// One magic_links row holds both the code and the link; using either
// consumes both. Consumed wins over the others: it worked, it's just spent.
export function evaluateSignIn(
  link: { expiresAt: Date; consumedAt: Date | null; attempts: number },
  now: Date,
): SignInState {
  if (link.consumedAt !== null) return "consumed";
  if (link.expiresAt.getTime() <= now.getTime()) return "expired";
  if (link.attempts >= CODE_MAX_ATTEMPTS) return "locked";
  return "usable";
}

// Per email address: a 30-second cooldown after the latest send, and at
// most 5 sends in any rolling hour (Brevo's free tier is 300 a day; an
// unthrottled resend button spends it on one inbox). `recentSends` is
// every send to that address; older ones are ignored.
export function checkSendAllowed(
  recentSends: Date[],
  now: Date,
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const hourAgo = now.getTime() - 3600_000;
  const inHour = recentSends.map((d) => d.getTime()).filter((t) => t > hourAgo).sort((x, y) => y - x);
  if (inHour.length > 0) {
    const sinceLatest = (now.getTime() - inHour[0]) / 1000;
    if (sinceLatest < SEND_COOLDOWN_SECONDS) {
      return { ok: false, retryAfterSeconds: Math.ceil(SEND_COOLDOWN_SECONDS - sinceLatest) };
    }
  }
  if (inHour.length >= SENDS_PER_HOUR) {
    const oldest = inHour[SENDS_PER_HOUR - 1];
    return { ok: false, retryAfterSeconds: Math.ceil((oldest + 3600_000 - now.getTime()) / 1000) };
  }
  return { ok: true };
}

const DEV_AUTH_SECRET = "kinomato-dev-only-auth-secret-not-for-production";

// Unknown configuration fails loud (CLAUDE.md): in production a missing
// secret would mean signing codes with a key anyone can read in this file.
export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET is not set. Sign-in codes are HMAC-signed with it; set it as a " +
        "Worker secret (wrangler secret put AUTH_SECRET) before deploying.",
    );
  }
  return DEV_AUTH_SECRET;
}
