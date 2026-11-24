import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import type { getDb } from "@/db";
import { clubs, memberships, reminderUnsubscribeTokens, users } from "@/db/schema";
import { hashToken } from "@/lib/authCredentials";
import { generateUnsubscribeToken, isUnsubscribeTokenShaped, isUnsubscribeTokenUsable } from "@/lib/reminderPrefs";

type Db = ReturnType<typeof getDb>;

// Reminder unsubscribe links (ruled 2026-11-23, docs/onboarding-spec.md
// §5.9). The only module that touches reminder_unsubscribe_tokens
// (lib/reminderTokenAccess.test.ts). A link's token is opaque and stored
// only as its hash; it's tied to one person and one club, works for 90
// days, and acts only on that person and that club. No request context and
// no Next.js here: reminders are sent from the hourly job (worker.ts).

// The full link for one person's reminders from one club, for a reminder
// email (r3). `origin` is the site's own, e.g. https://dev.kinomato.com:
// the job has no request to read it from.
export async function createUnsubscribeLink(db: Db, userId: string, clubId: string, origin: string): Promise<string> {
  const token = generateUnsubscribeToken();
  await db.insert(reminderUnsubscribeTokens).values({ tokenHash: hashToken(token), userId, clubId });
  return `${origin.replace(/\/+$/, "")}/unsubscribe/${token}`;
}

// What a link is for, if it still works: the person, the club and its
// name. Null for anything unknown, malformed or past 90 days.
export async function loadUnsubscribeToken(
  db: Db,
  token: string,
  now: Date,
): Promise<{ userId: string; clubId: string; clubName: string } | null> {
  if (!isUnsubscribeTokenShaped(token)) return null;
  const [row] = await db
    .select({
      userId: reminderUnsubscribeTokens.userId,
      clubId: reminderUnsubscribeTokens.clubId,
      createdAt: reminderUnsubscribeTokens.createdAt,
      clubName: clubs.name,
    })
    .from(reminderUnsubscribeTokens)
    .innerJoin(clubs, eq(reminderUnsubscribeTokens.clubId, clubs.id))
    .where(eq(reminderUnsubscribeTokens.tokenHash, hashToken(token)));
  if (!row || !isUnsubscribeTokenUsable(row, now)) return null;
  return { userId: row.userId, clubId: row.clubId, clubName: row.clubName };
}

// "Stop all reminder emails": that person's reminder emails off. False if
// the link no longer works (nothing changed).
export async function stopAllRemindersByToken(db: Db, token: string, now: Date): Promise<boolean> {
  const found = await loadUnsubscribeToken(db, token, now);
  if (!found) return false;
  await db.update(users).set({ emailReminders: false }).where(eq(users.id, found.userId));
  return true;
}

// "Mute only {club}": that person's active membership in that club, muted
// (kept as first muted). A club they've since left changes nothing.
export async function muteClubRemindersByToken(db: Db, token: string, now: Date): Promise<boolean> {
  const found = await loadUnsubscribeToken(db, token, now);
  if (!found) return false;
  await db
    .update(memberships)
    .set({ remindersMutedAt: now })
    .where(
      and(
        eq(memberships.userId, found.userId),
        eq(memberships.clubId, found.clubId),
        isNull(memberships.leftAt),
        isNull(memberships.remindersMutedAt),
      ),
    );
  return true;
}

// For account deletion and the under-13 discard: every link of one person.
export function deleteUnsubscribeTokensOf(db: Db, userId: string) {
  return db.delete(reminderUnsubscribeTokens).where(eq(reminderUnsubscribeTokens.userId, userId));
}

// For club deletion: every link for those clubs.
export function deleteUnsubscribeTokensOfClubs(db: Db, clubIds: string[]) {
  return db.delete(reminderUnsubscribeTokens).where(inArray(reminderUnsubscribeTokens.clubId, clubIds));
}

// For the retention job: links made before the cutoff (90 days), which no
// longer work anyway.
export function deleteExpiredUnsubscribeTokens(db: Db, createdBefore: Date) {
  return db
    .delete(reminderUnsubscribeTokens)
    .where(lt(reminderUnsubscribeTokens.createdAt, createdBefore))
    .returning({ tokenHash: reminderUnsubscribeTokens.tokenHash });
}
