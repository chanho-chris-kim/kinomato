import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// What the app would have emailed during an E2E run. With no Brevo key,
// lib/email.ts appends each message to this file when EMAIL_OUTBOX_FILE is
// set, which only Playwright's server does (playwright.config.ts). Global
// setup empties it at the start of every run. Never a real send.
export const EMAIL_OUTBOX_FILE = join(__dirname, "..", ".e2e-email-outbox.jsonl");

export interface SentEmail {
  kind:
    | "sign-in"
    | "email-change-code"
    | "email-taken-notice"
    | "email-changed-notice"
    | "account-deletion-code"
    | "account-deleted-receipt";
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

export function clearOutbox(): void {
  writeFileSync(EMAIL_OUTBOX_FILE, "");
}

export function sentTo(address: string): SentEmail[] {
  let text = "";
  try {
    text = readFileSync(EMAIL_OUTBOX_FILE, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SentEmail)
    .filter((m) => m.to === address);
}
