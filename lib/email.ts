// Magic-link delivery via Brevo's transactional email API. Mirrors
// lib/tmdb.ts's exact fallback shape: BREVO_API_KEY unset (always true
// in E2E/CI, on purpose, same reasoning as TMDB_READ_TOKEN) means no
// real send and no real network access. Unlike TMDB there's no fixture
// response to return — the caller already persisted the magic_links row
// (token, expiry) before calling this, so E2E reads the token straight
// out of that table via a direct DB connection (the same pattern
// voting-flow.spec.ts already uses for E2E_DATABASE_URL) rather than
// this module needing a dev-only "reveal the link" backdoor.
//
// Plain fetch, no SDK — this file is the whole provider abstraction, so
// swapping providers stays a one-file change.
const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

// kinomato.com is authenticated as a sending domain in Brevo.
const SENDER = { email: "hello@kinomato.com", name: "Kinomato" };

export async function sendMagicLinkEmail(email: string, verifyUrl: string): Promise<void> {
  // Read per call, not at module load, so tests can stub it.
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    // Local dev without a key, or E2E/CI — never a real send. Logged,
    // not silent, so a developer running without BREVO_API_KEY set can
    // still click through the flow by hand.
    console.log(`[email:magic-link] (no BREVO_API_KEY, not sent) ${email} -> ${verifyUrl}`);
    return;
  }

  const res = await fetch(BREVO_URL, {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: SENDER,
      to: [{ email }],
      subject: "Sign in to Kinomato",
      htmlContent: `<p>Click below to sign in. This link works once and expires shortly.</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`,
    }),
  });
  if (!res.ok) {
    // Brevo's error body is { code, message }; fall back to raw text if
    // it isn't JSON.
    const text = await res.text();
    let message = text;
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {}
    throw new Error(`Brevo failed to send to ${email}: ${res.status} ${message}`);
  }
}
