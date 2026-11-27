// Email via Amazon SES in ca-central-1 (docs/onboarding-spec.md §4, §5.9, §9):
// the sign-in code and link, the email-change code and notices, the
// account-deletion code and receipt (§11.4), and the ops alert when a
// scheduled job fails. worker.ts bundles this file for that alert, so it
// imports nothing from Next.js. Inside the Worker's scheduled handler,
// process.env carries the Worker's vars and secrets (nodejs_compat with a
// compatibility date after 2025-04-01; checked under ours on 2026-11-21).
// Mirrors lib/tmdb.ts's fallback shape: no SES credentials (always true in
// E2E/CI, on purpose) means no real send and no network access. In
// production that fails loud instead (the AUTH_SECRET posture), except on
// Playwright's own server, the only thing that sets EMAIL_OUTBOX_FILE.
// Codes are stored only as hashes, so E2E never reads them back from here
// either: it overwrites the stored hash with one for a code it chose
// (e2e/signIn.ts).
//
// No tracking, by design (ruled 2026-11-22): SES can only add an open
// pixel or rewrite links through a configuration set, and send() never
// names one (lib/email.test.ts pins that no ConfigurationSetName is ever
// sent). Email processing stays in Canada (ca-central-1).
//
// Plain fetch with a Web Crypto SigV4 signature (lib/awsSigV4.ts), no SDK:
// this file is the whole provider abstraction, so swapping providers stays
// a one-file change.
import { signRequest } from "./awsSigV4";

const SENDER = "Kinomato <hello@kinomato.com>";
const DEFAULT_SES_REGION = "ca-central-1";

// The SES credentials, or null when there are none (local dev, E2E/CI).
// Read per call, not at module load, so tests can stub them. Half a
// configuration, or none at all in production, fails loud.
function sesCredentials(): { accessKeyId: string; secretAccessKey: string; region: string } | null {
  const accessKeyId = process.env.SES_ACCESS_KEY_ID;
  const secretAccessKey = process.env.SES_SECRET_ACCESS_KEY;
  if (accessKeyId && secretAccessKey) {
    return { accessKeyId, secretAccessKey, region: process.env.SES_REGION || DEFAULT_SES_REGION };
  }
  if (accessKeyId || secretAccessKey) {
    throw new Error("Only one of SES_ACCESS_KEY_ID and SES_SECRET_ACCESS_KEY is set. Set both, or neither.");
  }
  if (process.env.NODE_ENV === "production" && !process.env.EMAIL_OUTBOX_FILE) {
    throw new Error(
      "SES_ACCESS_KEY_ID and SES_SECRET_ACCESS_KEY are not set, so no email can be sent. Set them " +
        "(and SES_REGION if not ca-central-1) as Worker secrets with wrangler secret put before " +
        "deploying (docs/ses-cutover.md).",
    );
  }
  return null;
}

interface Message {
  kind:
    | "sign-in"
    | "reminder"
    | "ops-alert"
    | "invite-only"
    | "email-change-code"
    | "email-taken-notice"
    | "email-changed-notice"
    | "account-deletion-code"
    | "account-deleted-receipt"
    | "join-approved";
  to: string;
  subject: string;
  html: string;
  // Optional plain-text part, and extra headers (List-Unsubscribe, for
  // reminders).
  text?: string;
  headers?: Record<string, string>;
  replyTo?: string;
}

// Where the old address's "if this wasn't you, reply" goes, and where an
// ops alert is sent. Unknown configuration fails loud (CLAUDE.md): neither
// is ever sent without it.
export function getSupportEmail(): string {
  const address = process.env.SUPPORT_EMAIL;
  if (!address) {
    throw new Error(
      "SUPPORT_EMAIL is not set. The email-change notice to the old address asks for a " +
        "reply if the change wasn't theirs, and needs a Reply-To to send it to; a failed " +
        "scheduled job's alert is sent there. Set it as a Worker secret (wrangler secret " +
        "put SUPPORT_EMAIL), or in .env locally.",
    );
  }
  return address;
}

// A scheduled job's run failed (app/scheduledJobs.ts). To SUPPORT_EMAIL:
// the job, the time and the run's counts, and nothing else: never an error
// message or any row data, which could carry names or emails. The detail
// is in Workers Logs.
export async function sendOpsAlert(
  job: "weekly-loop" | "retention",
  at: Date,
  counts: Record<string, number> | null,
): Promise<void> {
  const to = getSupportEmail();
  const countLine = counts
    ? Object.entries(counts)
        .filter(([key, value]) => /^[a-z_]+$/.test(key) && Number.isFinite(value))
        .map(([key, value]) => `${key.replaceAll("_", " ")} ${Number(value)}`)
        .join(", ")
    : "none: it stopped before finishing";
  await send({
    kind: "ops-alert",
    to,
    subject: `Kinomato: the ${job} job failed`,
    html:
      `<p>The ${job} job failed at ${at.toISOString()}.</p>` +
      `<p>Counts: ${countLine}.</p>` +
      `<p>See Workers Logs for the error: Workers &amp; Pages → kinomato → Logs, and ` +
      `Settings → Trigger events for the Cron Events list.</p>`,
  });
}

async function send(message: Message): Promise<void> {
  const ses = sesCredentials();
  if (!ses) {
    // Local dev without credentials, or E2E/CI: never a real send. Logged,
    // not silent, so a developer can still click through by hand.
    console.log(`[email:${message.kind}] (no SES credentials, not sent) to ${message.to}: ${message.subject}`);
    // Test-only outbox (Playwright's server sets EMAIL_OUTBOX_FILE; nothing
    // else does), so E2E can check what would have been sent.
    const outbox = process.env.EMAIL_OUTBOX_FILE;
    if (outbox) {
      const { appendFile } = await import("node:fs/promises");
      await appendFile(outbox, JSON.stringify(message) + "\n");
    }
    return;
  }

  // SES v2 SendEmail. Never a ConfigurationSetName: that's the only way SES
  // adds an open pixel or rewrites links.
  const url = `https://email.${ses.region}.amazonaws.com/v2/email/outbound-emails`;
  const body = JSON.stringify({
    FromEmailAddress: SENDER,
    Destination: { ToAddresses: [message.to] },
    ...(message.replyTo ? { ReplyToAddresses: [message.replyTo] } : {}),
    Content: {
      Simple: {
        Subject: { Data: message.subject, Charset: "UTF-8" },
        Body: {
          Html: { Data: message.html, Charset: "UTF-8" },
          ...(message.text ? { Text: { Data: message.text, Charset: "UTF-8" } } : {}),
        },
        ...(message.headers
          ? { Headers: Object.entries(message.headers).map(([Name, Value]) => ({ Name, Value })) }
          : {}),
      },
    },
  });
  const headers = await signRequest({
    method: "POST",
    url,
    headers: { "content-type": "application/json" },
    body,
    accessKeyId: ses.accessKeyId,
    secretAccessKey: ses.secretAccessKey,
    region: ses.region,
    service: "ses",
    now: new Date(),
  });
  const res = await fetch(url, { method: "POST", headers, body });
  if (!res.ok) {
    // SES's error body is { message }; fall back to raw text if it isn't
    // JSON. The recipient's address stays out of the error (and so the logs).
    const text = await res.text();
    let detail = text;
    try {
      detail = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {}
    throw new Error(`SES failed to send the ${message.kind} email: ${res.status} ${detail.slice(0, 200)}`);
  }
}

export async function sendSignInEmail(email: string, code: string, verifyUrl: string): Promise<void> {
  // Still logged in full without a key, so a developer can sign in by hand.
  if (!sesCredentials()) {
    console.log(`[email:sign-in] (no SES credentials, not sent) ${email} code ${code} -> ${verifyUrl}`);
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

// To an address with no account while sign-up is invite-only (§11.1,
// ruled 2026-11-18): no code, no link. The person asking sees the same
// screen as everyone (no enumeration, §4.3).
export async function sendInviteOnlyEmail(email: string): Promise<void> {
  await send({
    kind: "invite-only",
    to: email,
    subject: "Kinomato is invite-only for now",
    html: `<p>Kinomato is invite-only for now. Ask a member of a club to invite you.</p>`,
  });
}

// To the NEW address: the code that confirms it. No link: the change is
// confirmed on /settings, in the session that asked for it (§5.9).
export async function sendEmailChangeCode(newEmail: string, code: string): Promise<void> {
  if (!sesCredentials()) {
    console.log(`[email:email-change-code] (no SES credentials, not sent) ${newEmail} code ${code}`);
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

// To the account's own address: the code that confirms deleting it
// (§11.4). Entered in Settings, where it was asked for; sign-in never
// accepts it.
export async function sendAccountDeletionCode(email: string, code: string): Promise<void> {
  if (!sesCredentials()) {
    console.log(`[email:account-deletion-code] (no SES credentials, not sent) ${email} code ${code}`);
  }
  await send({
    kind: "account-deletion-code",
    to: email,
    subject: `${code} is your code to delete your Kinomato account`,
    html:
      `<p>Your code to delete your Kinomato account:</p>` +
      `<p style="font-size:28px;letter-spacing:4px;font-weight:600">${code}</p>` +
      `<p>Enter it in Settings, where you asked for it. It works once and expires in 15 minutes.</p>` +
      `<p>If you didn't ask for this, ignore this email. Nothing is deleted without the code.</p>`,
  });
}

// To the old address, once the account is deleted: the receipt, and
// nothing else (§11.4).
export async function sendAccountDeletedReceipt(email: string): Promise<void> {
  await send({
    kind: "account-deleted-receipt",
    to: email,
    subject: "Your Kinomato account was deleted",
    html: `<p>Your Kinomato account was deleted.</p>`,
  });
}

// "You're in {club}" (u5): to someone whose request to join was approved.
// Transactional: it never looks at reminder settings or counts against the
// reminder budget. Content from lib/joinRequests.ts.
export async function sendJoinApproved(email: string, message: { subject: string; html: string; text: string }): Promise<void> {
  await send({ kind: "join-approved", to: email, ...message });
}

// A reminder email (ruled 2026-11-23; content from lib/reminders.ts
// reminderContent). Every one carries RFC 8058 one-click unsubscribe:
// List-Unsubscribe pointing at the link's one-click URL, and
// List-Unsubscribe-Post, so a mail app's "Unsubscribe" stops all reminder
// emails with one POST (app/unsubscribe/[token]/one-click/route.ts).
export async function sendReminderEmail(
  to: string,
  content: { subject: string; html: string; text: string },
  oneClickUrl: string,
): Promise<void> {
  await send({
    kind: "reminder",
    to,
    subject: content.subject,
    html: content.html,
    text: content.text,
    headers: {
      "List-Unsubscribe": `<${oneClickUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
}
