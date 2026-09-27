// Sign-in delivery via Brevo's transactional email API: one email carrying
// a 6-digit code and a link (docs/onboarding-spec.md §4). Mirrors
// lib/tmdb.ts's exact fallback shape: BREVO_API_KEY unset (always true
// in E2E/CI, on purpose, same reasoning as TMDB_READ_TOKEN) means no
// real send and no real network access. Unlike TMDB there's no fixture
// response to return. The code and token are stored only as hashes, so
// E2E can't read them back either: it overwrites the row's hashes with
// ones for a code and token it chose (e2e/signIn.ts) rather than this
// module needing a dev-only "reveal the code" backdoor.
//
// Plain fetch, no SDK — this file is the whole provider abstraction, so
// swapping providers stays a one-file change.
const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

// kinomato.com is authenticated as a sending domain in Brevo.
const SENDER = { email: "hello@kinomato.com", name: "Kinomato" };

export async function sendSignInEmail(
  email: string,
  code: string,
  verifyUrl: string,
): Promise<void> {
  // Read per call, not at module load, so tests can stub it.
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    // Local dev without a key, or E2E/CI — never a real send. Logged,
    // not silent, so a developer running without BREVO_API_KEY set can
    // still click through the flow by hand.
    console.log(`[email:sign-in] (no BREVO_API_KEY, not sent) ${email} code ${code} -> ${verifyUrl}`);
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
      // The code leads the subject so it shows in the notification, where
      // phones pick up one-time codes to autofill.
      subject: `${code} is your Kinomato sign-in code`,
      htmlContent:
        `<p>Your sign-in code:</p>` +
        `<p style="font-size:28px;letter-spacing:4px;font-weight:600">${code}</p>` +
        `<p>Enter it where you asked for it. It works once and expires in 15 minutes.</p>` +
        `<p>Or sign in on this device: <a href="${verifyUrl}">${verifyUrl}</a></p>`,
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
