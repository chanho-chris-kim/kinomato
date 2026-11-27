// Reminder emails (ruled 2026-11-23, docs/onboarding-spec.md §5.9). Pure:
// which reminders are due, which fit each person's budget, and what each
// email says. app/reminders.ts loads the rows, claims, and sends.
//
// - Budget: at most 2 reminder emails per person per rolling 7 days, across
//   all their clubs, plus 1 "your turn" per night they pick. An email that
//   lists several clubs counts once. Over budget is dropped, not queued.
// - Kinds, in priority order (the first two that apply win): voting closes
//   soon, movie night is tonight, then did you watch it (a fill-in, only if
//   a slot is left). "Your turn" is the picker's extra.
// - Quiet hours 22:00–08:00 in the club's timezone: nothing is due then; a
//   reminder waits for 08:00 if its window is still open.
// - Only to people mayGetRemindersFrom allows.
// - Content: plain and short, one link per club, never a film title, name,
//   vote, count, RSVP list, limit or preference.

import { mayGetRemindersFrom } from "./reminderPrefs";
import { localDateParts, zonedTimeToUtc } from "./schedule";

export type ReminderKind = "your_turn" | "voting_closes" | "tonight" | "did_you_watch";

export const REMINDER_BUDGET = 2;
export const REMINDER_BUDGET_DAYS = 7;
const H = 3600_000;
// Budgeted kinds, highest priority first.
const PRIORITY: ReminderKind[] = ["voting_closes", "tonight", "did_you_watch"];
// The order emails go out in a run (and so which wait if the run is capped).
const SEND_ORDER: ReminderKind[] = ["voting_closes", "your_turn", "tonight", "did_you_watch"];

export interface ReminderNight {
  nightId: string;
  clubId: string;
  clubName: string;
  timezone: string;
  state: "draft" | "open" | "locked";
  scheduledAt: Date;
  // Effective deadlines (lib/nightDeadlines.ts), stored or fallen back.
  lockAt: Date;
  autoPassAt: Date;
  confirmableAt: Date | null;
  unconfirmAt: Date;
  pickerMembershipId: string;
}

export interface ReminderMember {
  membershipId: string;
  userId: string;
  clubId: string;
  emailReminders: boolean;
  leftAt: Date | null;
  remindersMutedAt: Date | null;
}

export interface DueReminder {
  kind: ReminderKind;
  userId: string;
  membershipId: string;
  nightId: string;
  night: ReminderNight;
}

export interface SentReminder {
  userId: string;
  kind: ReminderKind;
  nightId: string;
  sendId: string;
  sentAt: Date;
}

export interface PlannedEmail {
  userId: string;
  kind: ReminderKind;
  items: DueReminder[];
}

const plusHours = (d: Date, hours: number) => new Date(d.getTime() + hours * H);

// When each kind may be sent for a night: [opensAt, closesAt). A null
// opensAt is "from as soon as the night is in that state".
export function reminderWindow(kind: ReminderKind, night: ReminderNight): { opensAt: Date | null; closesAt: Date } {
  switch (kind) {
    case "your_turn":
      return { opensAt: null, closesAt: plusHours(night.autoPassAt, -6) };
    case "voting_closes":
      return { opensAt: plusHours(night.lockAt, -24), closesAt: plusHours(night.lockAt, -1) };
    case "tonight":
      return {
        opensAt: zonedTimeToUtc(localDateParts(night.scheduledAt, night.timezone), { hour: 8, minute: 0 }, night.timezone),
        closesAt: plusHours(night.scheduledAt, -1),
      };
    case "did_you_watch":
      return { opensAt: night.confirmableAt ?? night.scheduledAt, closesAt: plusHours(night.unconfirmAt, -6) };
  }
}

function inWindow(kind: ReminderKind, night: ReminderNight, now: Date): boolean {
  const { opensAt, closesAt } = reminderWindow(kind, night);
  return (opensAt === null || now.getTime() >= opensAt.getTime()) && now.getTime() < closesAt.getTime();
}

export function isQuietHours(now: Date, timezone: string): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).format(now),
  );
  return hour >= 22 || hour < 8;
}

const KINDS_FOR: Record<ReminderNight["state"], ReminderKind[]> = {
  draft: ["your_turn"],
  open: ["voting_closes"],
  locked: ["tonight", "did_you_watch"],
};

// Every reminder due now, before the budget. `notYetVoted` is, per open
// night, the memberships with no vote (from the history-read module);
// `rsvps`, per night, each membership's answer.
export function dueReminders(input: {
  now: Date;
  nights: ReminderNight[];
  members: ReminderMember[];
  notYetVoted: Map<string, Set<string>>;
  rsvps: Map<string, Map<string, "yes" | "no">>;
}): DueReminder[] {
  const due: DueReminder[] = [];
  for (const night of input.nights) {
    if (isQuietHours(input.now, night.timezone)) continue;
    const members = input.members.filter(
      (m) => m.clubId === night.clubId && mayGetRemindersFrom({ emailReminders: m.emailReminders, membership: m }),
    );
    const answers = input.rsvps.get(night.nightId) ?? new Map<string, "yes" | "no">();
    for (const kind of KINDS_FOR[night.state]) {
      if (!inWindow(kind, night, input.now)) continue;
      const recipients = members.filter((m) => {
        switch (kind) {
          case "your_turn":
            return m.membershipId === night.pickerMembershipId;
          case "voting_closes":
            return input.notYetVoted.get(night.nightId)?.has(m.membershipId) ?? false;
          case "tonight":
            return answers.get(m.membershipId) !== "no";
          case "did_you_watch":
            return answers.get(m.membershipId) === "yes";
        }
      });
      for (const m of recipients) {
        due.push({ kind, userId: m.userId, membershipId: m.membershipId, nightId: night.nightId, night });
      }
    }
  }
  return due;
}

// Which due reminders go out now: never one already sent for that night
// and kind; per person, "your turn" always (one email listing its clubs),
// then the budgeted kinds in priority order while the rolling budget
// allows, each kind one email listing its clubs.
export function planReminders(input: { now: Date; due: DueReminder[]; history: SentReminder[] }): PlannedEmail[] {
  const sentKey = (userId: string, kind: ReminderKind, nightId: string) => `${userId}|${kind}|${nightId}`;
  const sent = new Set(input.history.map((h) => sentKey(h.userId, h.kind, h.nightId)));
  const since = input.now.getTime() - REMINDER_BUDGET_DAYS * 24 * H;

  const byUser = new Map<string, DueReminder[]>();
  for (const d of input.due) {
    if (sent.has(sentKey(d.userId, d.kind, d.nightId))) continue;
    byUser.set(d.userId, [...(byUser.get(d.userId) ?? []), d]);
  }

  const emails: PlannedEmail[] = [];
  for (const [userId, items] of byUser) {
    const used = new Set(
      input.history
        .filter((h) => h.userId === userId && h.kind !== "your_turn" && h.sentAt.getTime() > since)
        .map((h) => h.sendId),
    ).size;
    let remaining = Math.max(0, REMINDER_BUDGET - used);
    const ofKind = (kind: ReminderKind) => items.filter((i) => i.kind === kind);

    const turns = ofKind("your_turn");
    const mine: PlannedEmail[] = turns.length ? [{ userId, kind: "your_turn", items: turns }] : [];
    for (const kind of PRIORITY) {
      const group = ofKind(kind);
      if (group.length && remaining > 0) {
        mine.push({ userId, kind, items: group });
        remaining -= 1;
      }
    }
    emails.push(...mine.sort((a, b) => SEND_ORDER.indexOf(a.kind) - SEND_ORDER.indexOf(b.kind)));
  }
  return emails.sort((a, b) => SEND_ORDER.indexOf(a.kind) - SEND_ORDER.indexOf(b.kind));
}

// ---- Content ----

export interface ReminderEntry {
  clubName: string;
  clubUrl: string;
  // The unsubscribe page for this club ("Mute only {club}").
  muteUrl: string;
  // The one time this kind mentions, already formatted ("Fri 8:00pm").
  when: string;
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function list(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const SUBJECTS: Record<ReminderKind, (clubs: string) => string> = {
  your_turn: (clubs) => `Your turn to pick for ${clubs}`,
  voting_closes: (clubs) => `Voting closes soon in ${clubs}`,
  tonight: (clubs) => `Movie night tonight: ${clubs}`,
  did_you_watch: (clubs) => `Did ${clubs} meet?`,
};

const LINES: Record<ReminderKind, (when: string) => string> = {
  your_turn: (when) => `Choose your films by ${when}, or your turn passes to the next person.`,
  voting_closes: (when) => `Voting closes ${when}. You haven't voted yet.`,
  tonight: (when) => `Movie night is tonight: ${when}.`,
  did_you_watch: (when) => `Tell the club whether you watched it. If nobody answers by ${when}, it's logged as unconfirmed.`,
};

// One email for one kind, listing one or more clubs. `stopUrl` is the
// unsubscribe link offered near the top ("Turn off reminders").
export function reminderContent(
  kind: ReminderKind,
  entries: ReminderEntry[],
  stopUrl: string,
): { subject: string; html: string; text: string } {
  const subject = SUBJECTS[kind](list(entries.map((e) => e.clubName)));
  const html =
    `<p>Don't want these? <a href="${escapeHtml(stopUrl)}">Turn off reminders</a></p>` +
    entries
      .map(
        (e) =>
          `<p><strong>${escapeHtml(e.clubName)}</strong><br>${escapeHtml(LINES[kind](e.when))}<br>` +
          `<a href="${escapeHtml(e.clubUrl)}">Open ${escapeHtml(e.clubName)}</a></p>`,
      )
      .join("") +
    `<hr><p style="font-size:13px;color:#666">At most two reminders a week across your clubs.<br>` +
    entries.map((e) => `<a href="${escapeHtml(e.muteUrl)}">Mute only ${escapeHtml(e.clubName)}</a>`).join(" · ") +
    `</p>`;
  const text = [
    `Don't want these? Turn off reminders: ${stopUrl}`,
    "",
    ...entries.flatMap((e) => [e.clubName, LINES[kind](e.when), `Open ${e.clubName}: ${e.clubUrl}`, ""]),
    "At most two reminders a week across your clubs.",
    ...entries.map((e) => `Mute only ${e.clubName}: ${e.muteUrl}`),
  ].join("\n");
  return { subject, html, text };
}
