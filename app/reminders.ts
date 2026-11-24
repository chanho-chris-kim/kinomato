import { and, eq, inArray, isNull } from "drizzle-orm";
import type { getDb } from "@/db";
import { clubs, memberships, nights, rsvps, users } from "@/db/schema";
import { getAutoAdvance, getConfirmAt, getLockTime } from "@/lib/clubSettings";
import { formatNightTime } from "@/lib/clubStatus";
import { confirmableAt } from "@/lib/confirmTiming";
import { sendReminderEmail } from "@/lib/email";
import { autoPassAtFor, effectiveLockAt, effectiveUnconfirmAt } from "@/lib/nightDeadlines";
import {
  dueReminders,
  planReminders,
  reminderContent,
  REMINDER_BUDGET_DAYS,
  type PlannedEmail,
  type ReminderKind,
  type ReminderNight,
} from "@/lib/reminders";
import { membershipsYetToVote } from "./clubs/[clubId]/historyRead";
import { claimReminder, loadReminderHistory, releaseReminder } from "./notificationLog";
import { createUnsubscribeLink } from "./reminderUnsubscribe";

type Db = ReturnType<typeof getDb>;

// Reminder emails (ruled 2026-11-23, docs/onboarding-spec.md §5.9): step f
// of the hourly weekly loop (app/weeklyLoop.ts). What's due and what fits
// the budget is lib/reminders.ts; this loads the rows, re-checks each email
// isn't moot just before it goes, claims it in the log
// (app/notificationLog.ts), sends it, and releases the claim if the send
// fails so the next hour retries. No Next.js anywhere here: worker.ts
// bundles it (lib/scheduledGraph.test.ts).

// Emails a run; the rest wait an hour (their windows permitting).
export const REMINDERS_PER_RUN = 20;

export type ReminderSender = (to: string, content: { subject: string; html: string; text: string }, oneClickUrl: string) => Promise<void>;

const STATE_FOR: Record<ReminderKind, ReminderNight["state"]> = {
  your_turn: "draft",
  voting_closes: "open",
  tonight: "locked",
  did_you_watch: "locked",
};

// The one time each kind's email mentions.
function whenFor(kind: ReminderKind, night: ReminderNight): string {
  const at = { your_turn: night.autoPassAt, voting_closes: night.lockAt, tonight: night.scheduledAt, did_you_watch: night.unconfirmAt }[kind];
  return formatNightTime(at, night.timezone);
}

export async function sendDueReminders(
  db: Db,
  now: Date,
  opts: { clubIds?: string[]; origin?: string; send?: ReminderSender },
  counts: { reminded: number; remind_failed: number },
): Promise<void> {
  if (opts.clubIds && opts.clubIds.length === 0) return;
  const scope = opts.clubIds ? inArray(nights.clubId, opts.clubIds) : undefined;

  const nightRows = await db
    .select({
      nightId: nights.id,
      clubId: nights.clubId,
      state: nights.state,
      scheduledAt: nights.scheduledAt,
      lockAt: nights.lockAt,
      lockedAt: nights.lockedAt,
      unconfirmAt: nights.unconfirmAt,
      pickerMembershipId: nights.pickerMembershipId,
      clubName: clubs.name,
      timezone: clubs.timezone,
      settings: clubs.settings,
    })
    .from(nights)
    .innerJoin(clubs, eq(nights.clubId, clubs.id))
    .where(and(inArray(nights.state, ["draft", "open", "locked"]), scope));
  if (nightRows.length === 0) return;

  const reminderNights: ReminderNight[] = nightRows.map((n) => {
    const lockTimeHours = getLockTime(n.settings);
    const confirmAt = getConfirmAt(n.settings);
    return {
      nightId: n.nightId,
      clubId: n.clubId,
      clubName: n.clubName,
      timezone: n.timezone,
      state: n.state as ReminderNight["state"],
      scheduledAt: n.scheduledAt,
      lockAt: effectiveLockAt({ lockAt: n.lockAt, scheduledAt: n.scheduledAt, lockTimeHours }),
      autoPassAt: autoPassAtFor({ scheduledAt: n.scheduledAt, lockTimeHours }),
      confirmableAt: confirmableAt(confirmAt, n.scheduledAt, n.timezone),
      unconfirmAt: effectiveUnconfirmAt({
        unconfirmAt: n.unconfirmAt,
        confirmAt,
        scheduledAt: n.scheduledAt,
        timezone: n.timezone,
        lockedAt: n.lockedAt,
        autoAdvanceHours: getAutoAdvance(n.settings),
      }),
      pickerMembershipId: n.pickerMembershipId,
    };
  });
  const clubIds = [...new Set(reminderNights.map((n) => n.clubId))];
  const nightIds = reminderNights.map((n) => n.nightId);

  const memberRows = await db
    .select({
      membershipId: memberships.id,
      userId: memberships.userId,
      clubId: memberships.clubId,
      leftAt: memberships.leftAt,
      remindersMutedAt: memberships.remindersMutedAt,
      emailReminders: users.emailReminders,
      email: users.email,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(and(inArray(memberships.clubId, clubIds), isNull(memberships.leftAt)));
  const emailOf = new Map(memberRows.map((m) => [m.userId, m.email]));

  const rsvpRows = await db
    .select({ nightId: rsvps.nightId, membershipId: rsvps.membershipId, status: rsvps.status })
    .from(rsvps)
    .where(inArray(rsvps.nightId, nightIds));
  const answers = new Map<string, Map<string, "yes" | "no">>();
  for (const r of rsvpRows) {
    if (!r.status) continue;
    if (!answers.has(r.nightId)) answers.set(r.nightId, new Map());
    answers.get(r.nightId)!.set(r.membershipId, r.status);
  }

  const notYetVoted = new Map<string, Set<string>>();
  for (const n of reminderNights.filter((n) => n.state === "open")) {
    const ids = memberRows.filter((m) => m.clubId === n.clubId).map((m) => m.membershipId);
    notYetVoted.set(n.nightId, new Set(await membershipsYetToVote(db, n.nightId, ids)));
  }

  const due = dueReminders({ now, nights: reminderNights, members: memberRows, notYetVoted, rsvps: answers });
  if (due.length === 0) return;
  const history = await loadReminderHistory(
    db,
    [...new Set(due.map((d) => d.userId))],
    [...new Set(due.map((d) => d.nightId))],
    new Date(now.getTime() - REMINDER_BUDGET_DAYS * 24 * 3600_000),
  );
  const planned = planReminders({ now, due, history }).slice(0, REMINDERS_PER_RUN);
  if (planned.length === 0) return;

  const origin = opts.origin ?? process.env.APP_ORIGIN;
  if (!origin) {
    // Unknown configuration fails loud (CLAUDE.md): never an email with
    // broken links. Counted, so the run fails and the ops alert goes.
    console.error("[weekly-loop] APP_ORIGIN is not set, so no reminder can link anywhere; none sent.");
    counts.remind_failed += planned.length;
    return;
  }
  const send = opts.send ?? sendReminderEmail;

  for (const email of planned) {
    try {
      const sent = await sendOne(db, now, email, emailOf.get(email.userId), origin, send);
      if (sent) counts.reminded += 1;
    } catch (err) {
      counts.remind_failed += 1;
      // The kind only: never the address, a name or a club.
      const what = err instanceof Error ? err.name : "unknown error";
      console.error(`[weekly-loop] a ${email.kind} reminder failed to send: ${what}`);
    }
  }
}

// One email: re-check it isn't moot, claim, send; release the claim if the
// send fails (and rethrow, so it's counted). False if nothing was left to
// send.
async function sendOne(
  db: Db,
  now: Date,
  email: PlannedEmail,
  to: string | undefined,
  origin: string,
  send: ReminderSender,
): Promise<boolean> {
  if (!to) return false;
  // Moot since planning? The night has moved on, or (voting) they voted.
  const fresh = await db
    .select({ id: nights.id, state: nights.state })
    .from(nights)
    .where(inArray(nights.id, email.items.map((i) => i.nightId)));
  const stateOf = new Map(fresh.map((n) => [n.id, n.state]));
  const live = [];
  for (const item of email.items) {
    if (stateOf.get(item.nightId) !== STATE_FOR[email.kind]) continue;
    if (email.kind === "voting_closes") {
      const yet = await membershipsYetToVote(db, item.nightId, [item.membershipId]);
      if (yet.length === 0) continue;
    }
    live.push(item);
  }
  if (live.length === 0) return false;

  const sendId = crypto.randomUUID();
  const claimed = new Set(
    await claimReminder(db, {
      userId: email.userId,
      kind: email.kind,
      sendId,
      sentAt: now,
      items: live.map((i) => ({ clubId: i.night.clubId, nightId: i.nightId })),
    }),
  );
  const items = live.filter((i) => claimed.has(i.nightId));
  if (items.length === 0) return false;

  try {
    const base = origin.replace(/\/+$/, "");
    const entries = [];
    for (const item of items) {
      entries.push({
        clubName: item.night.clubName,
        clubUrl: `${base}/clubs/${item.night.clubId}`,
        muteUrl: await createUnsubscribeLink(db, email.userId, item.night.clubId, base),
        when: whenFor(email.kind, item.night),
      });
    }
    // The first club's link stops all reminders, from the top line and the
    // one-click header alike.
    const stopUrl = entries[0].muteUrl;
    await send(to, reminderContent(email.kind, entries, stopUrl), `${stopUrl}/one-click`);
    return true;
  } catch (err) {
    await releaseReminder(db, sendId);
    throw err;
  }
}
