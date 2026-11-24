// Reminder preferences and unsubscribe links (docs/onboarding-spec.md §5.9,
// ruled 2026-11-23). Pure. Reminder emails default on (the friend phase;
// CASL consent is on the lawyer's list). Sign-in codes, email-change and
// deletion notices and ops alerts never look at these settings.
//
// An unsubscribe link carries an opaque token: 256 random bits, base64url,
// never an email, name, user id or club id. Only its hash is stored
// (lib/authCredentials.ts hashToken); each is tied to one person and one
// club, and stops working after 90 days (the retention job deletes it).

export const UNSUBSCRIBE_TOKEN_DAYS = 90;

const TOKEN_BYTES = 32;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function generateUnsubscribeToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Anything that couldn't be one of ours is turned away before any lookup.
export function isUnsubscribeTokenShaped(value: string): boolean {
  return TOKEN_SHAPE.test(value);
}

export function isUnsubscribeTokenUsable(token: { createdAt: Date }, now: Date): boolean {
  return now.getTime() < token.createdAt.getTime() + UNSUBSCRIBE_TOKEN_DAYS * 24 * 3600_000;
}

// Whether a club's reminders could go to this person (r3 sends them):
// reminder emails on, and that membership active and not muted.
export function mayGetRemindersFrom(input: {
  emailReminders: boolean;
  membership: { leftAt: Date | null; remindersMutedAt: Date | null };
}): boolean {
  return input.emailReminders && input.membership.leftAt === null && input.membership.remindersMutedAt === null;
}
