import { and, eq, inArray, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { getDb } from "@/db";
import { deleteEmailChangesOf } from "@/app/emailChange";
import {
  consentEvents,
  dataLicensingConsents,
  invites,
  magicLinks,
  memberships,
  nights,
  rsvps,
  sessions,
  users,
} from "@/db/schema";
import {
  type AgeBracket,
  acceptanceMethod,
  canOptInToLicensing,
  type ConsentGap,
  currentLicensing,
  isLicensingActive,
  type LicensingStatus,
  needsConsent,
} from "@/lib/consent";
import { currentLegal } from "@/lib/legal";

type Db = ReturnType<typeof getDb>;

// Consent, age and the data-licensing opt-in (docs/onboarding-spec.md
// §11.1–§11.3): the reads and writes behind /welcome, /consent, the gate in
// app/auth.ts and Settings' Data sharing. The rules themselves are pure, in
// lib/consent.ts.

export async function consentEventsFor(db: Db, userId: string) {
  return db.select().from(consentEvents).where(eq(consentEvents.userId, userId));
}

export async function consentGapsFor(db: Db, user: { id: string; ageBracket: AgeBracket | null }): Promise<ConsentGap[]> {
  return needsConsent(user, await consentEventsFor(db, user.id), currentLegal());
}

export async function licensingStatusFor(
  db: Db,
  userId: string,
): Promise<{ status: LicensingStatus; rows: (typeof dataLicensingConsents.$inferSelect)[] }> {
  const rows = await db.select().from(dataLicensingConsents).where(eq(dataLicensingConsents.userId, userId));
  return { status: currentLicensing(rows), rows };
}

// What the consent form submitted, already checked by the caller: the
// Terms box ticked, an age chosen that isn't "Under 13".
export interface ConsentAnswers {
  // Null when the form didn't ask: the account already has one.
  age: AgeBracket | null;
  licensing: boolean;
  // /welcome saves the name in the same batch, so a new account is named
  // and consented together or not at all.
  displayName?: string;
}

// Records what's missing, in one batch: an acceptance of each document
// whose newest row isn't the current version (signup the first time,
// reconsent after a version change), the age if it was never asked (asked
// once: an answer already given isn't replaced), and the opt-in if ticked.
// The opt-in is decided here, from the age that will be stored, never from
// the form: a 13–17 opt-in is dropped whatever was sent.
export async function recordConsent(db: Db, userId: string, answers: ConsentAnswers, now = new Date()) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return;
  const legal = currentLegal();
  const events = await db.select().from(consentEvents).where(eq(consentEvents.userId, userId));
  const gaps = needsConsent(user, events, legal);
  const age = user.ageBracket ?? answers.age;

  const statements: BatchItem<"pg">[] = [];
  for (const document of ["terms", "privacy"] as const) {
    if (!gaps.includes(document)) continue;
    statements.push(
      db.insert(consentEvents).values({
        userId,
        document,
        version: legal[document].version,
        acceptedAt: now,
        method: acceptanceMethod(events, document),
      }),
    );
  }
  const userChanges = {
    ...(answers.displayName ? { displayName: answers.displayName } : {}),
    ...(!user.ageBracket && age ? { ageBracket: age, ageAttestedAt: now } : {}),
  };
  if (Object.keys(userChanges).length) {
    statements.push(db.update(users).set(userChanges).where(eq(users.id, userId)));
  }
  if (answers.licensing && canOptInToLicensing(age)) {
    const { rows } = await licensingStatusFor(db, userId);
    if (!isLicensingActive(rows, age, legal.licensing.version)) {
      statements.push(...licensingOptIn(db, userId, now));
    }
  }
  if (statements.length) await db.batch(statements as [BatchItem<"pg">, ...BatchItem<"pg">[]]);
}

// Opting in: a new row on the current wording. Any row still open on an
// older wording is closed first, so there's only ever one open row.
function licensingOptIn(db: Db, userId: string, now: Date): BatchItem<"pg">[] {
  return [
    db
      .update(dataLicensingConsents)
      .set({ withdrawnAt: now })
      .where(and(eq(dataLicensingConsents.userId, userId), isNull(dataLicensingConsents.withdrawnAt))),
    db.insert(dataLicensingConsents).values({
      userId,
      wordingVersion: currentLegal().licensing.version,
      optedInAt: now,
    }),
  ];
}

// Settings' Data sharing. Both re-check age server-side.
export async function optInToLicensing(db: Db, userId: string, now = new Date()) {
  const [user] = await db.select({ ageBracket: users.ageBracket }).from(users).where(eq(users.id, userId));
  if (!user || !canOptInToLicensing(user.ageBracket)) return;
  await db.batch(licensingOptIn(db, userId, now) as [BatchItem<"pg">, ...BatchItem<"pg">[]]);
}

// Future-only (§11.2): sets withdrawn_at, deletes nothing.
export async function withdrawFromLicensing(db: Db, userId: string, now = new Date()) {
  await db
    .update(dataLicensingConsents)
    .set({ withdrawnAt: now })
    .where(and(eq(dataLicensingConsents.userId, userId), isNull(dataLicensingConsents.withdrawnAt)));
}

// "Under 13" on /welcome (§11.3): nothing persists, and nothing records
// that it happened. A brand-new account has nothing else yet, since every
// other page was gated: the account, its sessions, its sign-in codes, and
// any membership an invite just created. The invite goes back to
// unredeemed, so the owner's seat count is right and the link works for
// whoever it's really for. A new member is first in the rotation, so a
// club's Tonight may already have lazily drafted a night for them; that
// draft goes too (it has nothing on it but RSVPs). Then the user row.
export async function discardNewAccount(db: Db, userId: string): Promise<void> {
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  if (!user) return;
  const membershipIds = (
    await db.select({ id: memberships.id }).from(memberships).where(eq(memberships.userId, userId))
  ).map((m) => m.id);
  const draftIds = membershipIds.length
    ? (
        await db
          .select({ id: nights.id })
          .from(nights)
          .where(and(inArray(nights.pickerMembershipId, membershipIds), eq(nights.state, "draft")))
      ).map((n) => n.id)
    : [];

  const statements: BatchItem<"pg">[] = [];
  if (draftIds.length) {
    statements.push(db.delete(rsvps).where(inArray(rsvps.nightId, draftIds)));
    statements.push(db.delete(nights).where(inArray(nights.id, draftIds)));
  }
  statements.push(
    db
      .update(invites)
      .set({ redeemedAt: null, redeemedByUserId: null })
      .where(eq(invites.redeemedByUserId, userId)),
    db.delete(memberships).where(eq(memberships.userId, userId)),
    db.delete(sessions).where(eq(sessions.userId, userId)),
    db.delete(magicLinks).where(eq(magicLinks.email, user.email)),
    deleteEmailChangesOf(db, userId),
    db.delete(consentEvents).where(eq(consentEvents.userId, userId)),
    db.delete(dataLicensingConsents).where(eq(dataLicensingConsents.userId, userId)),
    db.delete(users).where(eq(users.id, userId)),
  );
  await db.batch(statements as [BatchItem<"pg">, ...BatchItem<"pg">[]]);
}
