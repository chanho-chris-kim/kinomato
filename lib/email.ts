// Magic-link delivery via Resend. Mirrors lib/tmdb.ts's exact fallback
// shape: RESEND_API_KEY unset (always true in E2E/CI, on purpose, same
// reasoning as TMDB_READ_TOKEN) means no real send and no real network
// access. Unlike TMDB there's no fixture response to return — the
// caller already persisted the magic_links row (token, expiry) before
// calling this, so E2E reads the token straight out of that table via
// a direct DB connection (the same pattern voting-flow.spec.ts already
// uses for E2E_DATABASE_URL) rather than this module needing a
// dev-only "reveal the link" backdoor.
import { Resend } from "resend";

const API_KEY = process.env.RESEND_API_KEY;

// Requires a domain verified with Resend before this can actually
// deliver in production — not yet done as of this pass. Update once a
// sending domain is verified.
const FROM_ADDRESS = "Kinomato <hello@kinomato.com>";

export async function sendMagicLinkEmail(email: string, verifyUrl: string): Promise<void> {
  if (!API_KEY) {
    // Local dev without a key, or E2E/CI — never a real send. Logged,
    // not silent, so a developer running without RESEND_API_KEY set can
    // still click through the flow by hand.
    console.log(`[email:magic-link] (no RESEND_API_KEY, not sent) ${email} -> ${verifyUrl}`);
    return;
  }

  const resend = new Resend(API_KEY);
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: "Sign in to Kinomato",
    html: `<p>Click below to sign in. This link works once and expires shortly.</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`,
  });
  if (error) {
    throw new Error(`Resend failed to send to ${email}: ${error.message}`);
  }
}
