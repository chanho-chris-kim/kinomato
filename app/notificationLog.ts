import { and, eq, gt, inArray, lt, or } from "drizzle-orm";
import type { getDb } from "@/db";
import { clubs, notificationLog } from "@/db/schema";
import type { ReminderKind, SentReminder } from "@/lib/reminders";

type Db = ReturnType<typeof getDb>;

// The reminder log (ruled 2026-11-23): the only module that touches
// notification_log (lib/notificationLogAccess.test.ts). A reminder is
// claimed (a row per person, kind and night, unique) before its email is
// sent, and released if the send fails, so it goes at most once and the
// next hour retries a failure. No request context and no Next.js: the
// hourly job runs this (worker.ts).

// What's been sent to these people: every row for these nights (never
// twice), and every row since `since` (the rolling budget).
export async function loadReminderHistory(
  db: Db,
  userIds: string[],
  nightIds: string[],
  since: Date,
): Promise<SentReminder[]> {
  if (userIds.length === 0) return [];
  return db
    .select({
      userId: notificationLog.userId,
      kind: notificationLog.kind,
      nightId: notificationLog.nightId,
      sendId: notificationLog.sendId,
      sentAt: notificationLog.sentAt,
    })
    .from(notificationLog)
    .where(
      and(
        inArray(notificationLog.userId, userIds),
        nightIds.length ? or(gt(notificationLog.sentAt, since), inArray(notificationLog.nightId, nightIds)) : gt(notificationLog.sentAt, since),
      ),
    );
}

// Claims one email's reminders, one row per club night, all sharing
// `sendId`. Returns the night ids actually claimed: one claimed already
// (another run got there first) is left out, and if none are left, nothing
// should be sent.
export async function claimReminder(
  db: Db,
  input: { userId: string; kind: ReminderKind; sendId: string; sentAt: Date; items: { clubId: string; nightId: string }[] },
): Promise<string[]> {
  if (input.items.length === 0) return [];
  const rows = await db
    .insert(notificationLog)
    .values(
      input.items.map((i) => ({
        userId: input.userId,
        kind: input.kind,
        clubId: i.clubId,
        nightId: i.nightId,
        sendId: input.sendId,
        sentAt: input.sentAt,
      })),
    )
    .onConflictDoNothing()
    .returning({ nightId: notificationLog.nightId });
  return rows.map((r) => r.nightId);
}

// A send that failed: its claim goes, so the next run can try again.
export async function releaseReminder(db: Db, sendId: string): Promise<void> {
  await db.delete(notificationLog).where(eq(notificationLog.sendId, sendId));
}

// Your own reminders, for Download my data (§11.5): what kind, which club,
// when. Nobody else's.
export async function ownNotificationLog(db: Db, userId: string) {
  return db
    .select({ kind: notificationLog.kind, clubName: clubs.name, sentAt: notificationLog.sentAt })
    .from(notificationLog)
    .innerJoin(clubs, eq(notificationLog.clubId, clubs.id))
    .where(eq(notificationLog.userId, userId));
}

// For account deletion and the under-13 discard.
export function deleteNotificationLogOf(db: Db, userId: string) {
  return db.delete(notificationLog).where(eq(notificationLog.userId, userId));
}

// For club deletion.
export function deleteNotificationLogOfClubs(db: Db, clubIds: string[]) {
  return db.delete(notificationLog).where(inArray(notificationLog.clubId, clubIds));
}

// For the retention job: rows older than the cutoff (30 days).
export function deleteOldNotificationLog(db: Db, sentBefore: Date) {
  return db.delete(notificationLog).where(lt(notificationLog.sentAt, sentBefore)).returning({ id: notificationLog.id });
}
