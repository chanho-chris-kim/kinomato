import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { getDb } from "@/db";
import { emailChanges, magicLinks, users } from "@/db/schema";
import { endOtherSessions } from "@/app/session";
import { checkSendAllowed, codeMatches, generateSignInCode, getAuthSecret, hashCode, CODE_MAX_ATTEMPTS } from "@/lib/authCredentials";
import { getSupportEmail, sendEmailChangeCode, sendEmailChangedNotice, sendEmailTakenNotice } from "@/lib/email";
import { maskEmail, normaliseEmail } from "@/lib/emailAddress";
import { checkChangeRequestAllowed, EMAIL_CHANGE_DURATION_MS, evaluateEmailChange } from "@/lib/emailChange";

// Email change (docs/onboarding-spec.md §5.9 rulings; rebuild step 7b). The
// only code that touches email_changes (lib/emailChangeAccess.test.ts).
// Sign-in never reads the table: a change code can't create or sign in to
// an account. Sign-in's per-address send limit counts this table's sends
// through recentEmailChangeSendsTo, which returns timestamps and nothing
// else.

type Db = ReturnType<typeof getDb>;
type User = { id: string; email: string };
export type EmailChangeResult = { ok: true } | { ok: false; error: string };

// For sign-in's per-address limit (§4.3), shared with email changes: when
// codes or notices were sent to this address. Timestamps only.
export async function recentEmailChangeSendsTo(db: Db, email: string, since: Date): Promise<Date[]> {
  const rows = await db
    .select({ createdAt: emailChanges.createdAt })
    .from(emailChanges)
    .where(and(eq(emailChanges.newEmail, email), gt(emailChanges.createdAt, since)));
  return rows.map((r) => r.createdAt);
}

// The person's change in progress: the newest request not yet used or
// cancelled. Shown on /settings with Cancel; only the address, masked.
export async function pendingEmailChange(
  db: Db,
  userId: string,
  now: Date,
): Promise<{ maskedNewEmail: string; state: ReturnType<typeof evaluateEmailChange> } | null> {
  const row = await newestOpen(db, userId);
  return row ? { maskedNewEmail: maskEmail(row.newEmail), state: evaluateEmailChange(row, now) } : null;
}

async function newestOpen(db: Db, userId: string) {
  const [row] = await db
    .select()
    .from(emailChanges)
    .where(and(eq(emailChanges.userId, userId), isNull(emailChanges.consumedAt), isNull(emailChanges.cancelledAt)))
    .orderBy(desc(emailChanges.createdAt))
    .limit(1);
  return row ?? null;
}

// Ask to move the account to a new address. The same outcome on screen
// whether or not that address already has an account (§4.3: nothing
// revealed): a free address gets the code, a taken one a notice instead.
export async function requestEmailChange(db: Db, user: User, rawNewEmail: string, now: Date): Promise<EmailChangeResult> {
  getSupportEmail(); // fail loud before anything is sent or stored
  const newEmail = normaliseEmail(rawNewEmail);
  if (!newEmail.includes("@") || newEmail.startsWith("@") || newEmail.endsWith("@")) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (newEmail === user.email) return { ok: false, error: "That's already your email." };

  const dayAgo = new Date(now.getTime() - 24 * 3600_000);
  const mine = await db
    .select({ createdAt: emailChanges.createdAt })
    .from(emailChanges)
    .where(and(eq(emailChanges.userId, user.id), gt(emailChanges.createdAt, dayAgo)));
  if (!checkChangeRequestAllowed(mine.map((r) => r.createdAt), now)) {
    return { ok: false, error: "You can ask to change your email 3 times a day. Try again tomorrow." };
  }

  // Per address, shared with sign-in: sign-in codes and change sends alike.
  const hourAgo = new Date(now.getTime() - 3600_000);
  const [signIns, changes] = await Promise.all([
    db
      .select({ createdAt: magicLinks.createdAt })
      .from(magicLinks)
      .where(and(eq(magicLinks.email, newEmail), gt(magicLinks.createdAt, hourAgo))),
    recentEmailChangeSendsTo(db, newEmail, hourAgo),
  ]);
  const allowed = checkSendAllowed([...signIns.map((r) => r.createdAt), ...changes], now);
  if (!allowed.ok) {
    return { ok: false, error: `Wait ${allowed.retryAfterSeconds} seconds before asking for another code.` };
  }

  const code = generateSignInCode();
  // A newer request cancels the older one (§5.9).
  await db.batch([
    db
      .update(emailChanges)
      .set({ cancelledAt: now })
      .where(and(eq(emailChanges.userId, user.id), isNull(emailChanges.consumedAt), isNull(emailChanges.cancelledAt))),
    db.insert(emailChanges).values({
      userId: user.id,
      newEmail,
      codeHash: hashCode(code, getAuthSecret()),
      expiresAt: new Date(now.getTime() + EMAIL_CHANGE_DURATION_MS),
      createdAt: now,
    }),
  ]);

  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, newEmail));
  if (taken) await sendEmailTakenNotice(newEmail);
  else await sendEmailChangeCode(newEmail, code);
  return { ok: true };
}

// Enter the code: the change applies, every other session ends (this one
// stays), and the old address is told, with the new one masked.
export async function confirmEmailChange(db: Db, user: User, rawCode: string, now: Date): Promise<EmailChangeResult> {
  getSupportEmail(); // fail loud before the change, never after it
  const row = await newestOpen(db, user.id);
  if (!row) return { ok: false, error: "There's no change waiting. Ask for a new code." };
  const state = evaluateEmailChange(row, now);
  if (state === "expired") return { ok: false, error: "That code has expired. Ask for a new one." };
  if (state === "locked") return { ok: false, error: "Too many wrong codes. Ask for a new one." };

  if (!codeMatches(rawCode.replace(/\s+/g, ""), row.codeHash, getAuthSecret())) {
    const attempts = row.attempts + 1;
    await db.update(emailChanges).set({ attempts }).where(eq(emailChanges.id, row.id));
    return {
      ok: false,
      error: attempts >= CODE_MAX_ATTEMPTS ? "Too many wrong codes. Ask for a new one." : "That code didn't work.",
    };
  }

  // Taken since the request (someone signed up with it meanwhile): the
  // change can't happen. Said the same way as any spent code.
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, row.newEmail));
  if (taken) {
    await db.update(emailChanges).set({ cancelledAt: now }).where(eq(emailChanges.id, row.id));
    return { ok: false, error: "That code didn't work. Ask for a new one." };
  }

  // Consumed conditionally: a double submit loses cleanly.
  const [consumed] = await db
    .update(emailChanges)
    .set({ consumedAt: now })
    .where(and(eq(emailChanges.id, row.id), isNull(emailChanges.consumedAt), isNull(emailChanges.cancelledAt)))
    .returning({ id: emailChanges.id });
  if (!consumed) return { ok: false, error: "That code didn't work. Ask for a new one." };

  try {
    await db.update(users).set({ email: row.newEmail }).where(eq(users.id, user.id));
  } catch (error) {
    // users.email is unique: lost a race to a sign-up on that address.
    if ((error as { code?: string })?.code === "23505" || (error as { cause?: { code?: string } })?.cause?.code === "23505") {
      return { ok: false, error: "That code didn't work. Ask for a new one." };
    }
    throw error;
  }
  await endOtherSessions(db, user.id);
  await sendEmailChangedNotice(user.email, maskEmail(row.newEmail));
  return { ok: true };
}

export async function cancelEmailChange(db: Db, userId: string, now: Date): Promise<void> {
  await db
    .update(emailChanges)
    .set({ cancelledAt: now })
    .where(and(eq(emailChanges.userId, userId), isNull(emailChanges.consumedAt), isNull(emailChanges.cancelledAt)));
}

// Every email change of an account, deleted: for the §11.4 anonymisation
// (app/anonymise.ts) and the "Under 13" removal (app/consent.ts). Returned
// unrun, for the caller's db.batch, so email_changes stays this module's.
export function deleteEmailChangesOf(db: Db, userId: string) {
  return db.delete(emailChanges).where(eq(emailChanges.userId, userId));
}
