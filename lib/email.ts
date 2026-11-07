// Email via Brevo's transactional API (docs/onboarding-spec.md §4, §5.9):
// the sign-in code and link, and the email-change code and notices.
// Mirrors lib/tmdb.ts's fallback shape: BREVO_API_KEY unset (always true in
// E2E/CI, on purpose) means no real send and no network access. Codes are
// stored only as hashes, so E2E never reads them back from here either: it
// overwrites the stored hash with one for a code it chose (e2e/signIn.ts).
//
// Plain fetch, no SDK — this file is the whole provider abstraction, so
// swapping providers stays a one-file change.
const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

// kinomato.com is authenticated as a sending domain in Brevo.
const SENDER = { email: "hello@kinomato.com", name: "Kinomato" };

interface Message {
  kind: "sign-in" | "email-change-code" | "email-taken-notice" | "email-changed-notice";
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

// Where the old address's "if this wasn't you, reply" goes. Unknown
// configuration fails loud (CLAUDE.md): that notice is never sent without
// somewhere for the reply to land.
export function getSupportEmail(): string {
  const address = process.env.SUPPORT_EMAIL;
  if (!address) {
    throw new Error(
      "SUPPORT_EMAIL is not set. The email-change notice to the old address asks for a " +
        "reply if the change wasn't theirs, and needs a Reply-To to send it to. Set it as a " +
        "Worker secret (wrangler secret put SUPPORT_EMAIL), or in .env locally.",
    );
  }
  return address;
}

async function send(message: Message): Promise<void> {
  // Read per call, not at module load, so tests can stub it.
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    // Local dev without a key, or E2E/CI: never a real send. Logged, not
    // silent, so a developer can still click through by hand.
    console.log(`[email:${message.kind}] (no BREVO_API_KEY, not sent) to ${message.to}: ${message.subject}`);
    // Test-only outbox (Playwright's server sets EMAIL_OUTBOX_FILE; nothing
    // else does), so E2E can check what would have been sent.
    const outbox = process.env.EMAIL_OUTBOX_FILE;
    if (outbox) {
      const { appendFile } = await import("node:fs/promises");
      await appendFile(outbox, JSON.stringify(message) + "\n");
    }
    return;
  }

  const res = await fetch(BREVO_URL, {
    method: "POST",
    headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: SENDER,
      to: [{ email: message.to }],
      ...(message.replyTo ? { replyTo: { email: message.replyTo } } : {}),
      subject: message.subject,
      htmlContent: message.html,
    }),
  });
  if (!res.ok) {
    // Brevo's error body is { code, message }; fall back to raw text if
    // it isn't JSON.
    const text = await res.text();
    let detail = text;
    try {
      detail = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {}
    throw new Error(`Brevo failed to send to ${message.to}: ${res.status} ${detail}`);
  }
}

export async function sendSignInEmail(email: string, code: string, verifyUrl: string): Promise<void> {
  // Still logged in full without a key, so a developer can sign in by hand.
  if (!process.env.BREVO_API_KEY) {
    console.log(`[email:sign-in] (no BREVO_API_KEY, not sent) ${email} code ${code} -> ${verifyUrl}`);
  }
  await send({
    kind: "sign-in",
    to: email,
    // The code leads the subject so it shows in the notification, where
    // phones pick up one-time codes to autofill.
    subject: `${code} is your Kinomato sign-in code`,
    html:
      `<p>Your sign-in code:</p>` +
      `<p style="font-size:28px;letter-spacing:4px;font-weight:600">${code}</p>` +
      `<p>Enter it where you asked for it. It works once and expires in 15 minutes.</p>` +
      `<p>Or sign in on this device: <a href="${verifyUrl}">${verifyUrl}</a></p>`,
  });
}

// To the NEW address: the code that confirms it. No link: the change is
// confirmed on /settings, in the session that asked for it (§5.9).
export async function sendEmailChangeCode(newEmail: string, code: string): Promise<void> {
  if (!process.env.BREVO_API_KEY) {
    console.log(`[email:email-change-code] (no BREVO_API_KEY, not sent) ${newEmail} code ${code}`);
  }
  await send({
    kind: "email-change-code",
    to: newEmail,
    subject: `${code} is your code to move your Kinomato account to this address`,
    html:
      `<p>Your code to move your Kinomato account to this address:</p>` +
      `<p style="font-size:28px;letter-spacing:4px;font-weight:600">${code}</p>` +
      `<p>Enter it in Settings, where you asked for it. It works once and expires in 15 minutes.</p>` +
      `<p>If you didn't ask for this, ignore this email. Nothing changes without the code.</p>`,
  });
}

// To a new address that already has its own account: a notice instead of
// a code. The person asking sees nothing different (no enumeration, §4.3).
export async function sendEmailTakenNotice(address: string): Promise<void> {
  await send({
    kind: "email-taken-notice",
    to: address,
    subject: "Someone tried to move a Kinomato account to this address",
    html:
      `<p>Someone tried to move a Kinomato account to this address. ` +
      `You already have one, so nothing changed.</p>`,
  });
}

// To the OLD address once the change is done: the new address masked,
// never in full, and replies going to support.
export async function sendEmailChangedNotice(oldEmail: string, maskedNewEmail: string): Promise<void> {
  const replyTo = getSupportEmail();
  await send({
    kind: "email-changed-notice",
    to: oldEmail,
    replyTo,
    subject: "Your Kinomato email was changed",
    html:
      `<p>Your Kinomato email was changed to ${maskedNewEmail}. ` +
      `If this wasn't you, reply to this email.</p>`,
  });
}
