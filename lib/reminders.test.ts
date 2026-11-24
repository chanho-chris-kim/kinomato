import { describe, expect, it } from "vitest";
import {
  dueReminders,
  isQuietHours,
  planReminders,
  reminderContent,
  reminderWindow,
  type DueReminder,
  type ReminderMember,
  type ReminderNight,
} from "./reminders";

// Reminder emails (ruled 2026-11-23, docs/onboarding-spec.md §5.9). Pure:
// which reminders are due, and which fit the budget.

const H = 3600_000;
const NY = "America/New_York";
const LA = "America/Los_Angeles";
const VANCOUVER = "America/Vancouver";
const plus = (d: Date, hours: number) => new Date(d.getTime() + hours * H);

// Sat 2026-11-14 20:00 New York (UTC−5) = 01:00Z on the 15th.
const SAT = new Date("2026-11-15T01:00:00Z");
function night(o: Partial<ReminderNight> = {}): ReminderNight {
  return {
    nightId: "n1",
    clubId: "c1",
    clubName: "Saturday Club",
    timezone: NY,
    state: "open",
    scheduledAt: SAT,
    lockAt: plus(SAT, -24),
    autoPassAt: plus(SAT, -24),
    confirmableAt: plus(SAT, 13), // 9am the next morning
    unconfirmAt: plus(SAT, 61),
    pickerMembershipId: "m-pia",
    ...o,
  };
}
function member(id: string, o: Partial<ReminderMember> = {}): ReminderMember {
  return { membershipId: `m-${id}`, userId: `u-${id}`, clubId: "c1", emailReminders: true, leftAt: null, remindersMutedAt: null, ...o };
}
const MEMBERS = [member("pia"), member("ana"), member("ben")];

describe("reminderWindow (every edge)", () => {
  it("voting closes soon: lock_at − 24h to lock_at − 1h", () => {
    const n = night();
    expect(reminderWindow("voting_closes", n)).toEqual({ opensAt: plus(n.lockAt, -24), closesAt: plus(n.lockAt, -1) });
  });

  it("movie night is tonight: 08:00 local on the night's day to scheduled_at − 1h", () => {
    const n = night({ state: "locked" });
    // 08:00 New York on Sat 14 = 13:00Z.
    expect(reminderWindow("tonight", n)).toEqual({ opensAt: new Date("2026-11-14T13:00:00Z"), closesAt: plus(SAT, -1) });
  });

  it("did you watch it: from the prompt (or the night) to unconfirm_at − 6h", () => {
    const n = night({ state: "locked" });
    expect(reminderWindow("did_you_watch", n)).toEqual({ opensAt: n.confirmableAt, closesAt: plus(n.unconfirmAt, -6) });
    expect(reminderWindow("did_you_watch", night({ state: "locked", confirmableAt: null })).opensAt).toEqual(SAT);
  });

  it("your turn: from the draft to autoPassAt − 6h", () => {
    const n = night({ state: "draft" });
    expect(reminderWindow("your_turn", n)).toEqual({ opensAt: null, closesAt: plus(n.autoPassAt, -6) });
  });

  it("tonight's 08:00 is local on a DST day (Los Angeles both ways)", () => {
    // Sun 2026-11-01 20:00 PST; 08:00 PST = 16:00Z.
    const fallBack = night({ state: "locked", timezone: LA, scheduledAt: new Date("2026-11-02T04:00:00Z") });
    expect(reminderWindow("tonight", fallBack).opensAt).toEqual(new Date("2026-11-01T16:00:00Z"));
    // Sun 2026-03-08 20:00 PDT; 08:00 PDT = 15:00Z.
    const springForward = night({ state: "locked", timezone: LA, scheduledAt: new Date("2026-03-09T03:00:00Z") });
    expect(reminderWindow("tonight", springForward).opensAt).toEqual(new Date("2026-03-08T15:00:00Z"));
  });
});

describe("isQuietHours (22:00–08:00 in the club's timezone)", () => {
  it("at each edge, in New York", () => {
    expect(isQuietHours(new Date("2026-11-14T02:59:00Z"), NY)).toBe(false); // 21:59
    expect(isQuietHours(new Date("2026-11-14T03:00:00Z"), NY)).toBe(true); // 22:00
    expect(isQuietHours(new Date("2026-11-14T12:59:00Z"), NY)).toBe(true); // 07:59
    expect(isQuietHours(new Date("2026-11-14T13:00:00Z"), NY)).toBe(false); // 08:00
  });

  it("across DST in Los Angeles", () => {
    // Sun 2026-11-01: 07:59 PST = 15:59Z (quiet), 08:00 PST = 16:00Z.
    expect(isQuietHours(new Date("2026-11-01T15:59:00Z"), LA)).toBe(true);
    expect(isQuietHours(new Date("2026-11-01T16:00:00Z"), LA)).toBe(false);
    // Sun 2026-03-08: 08:00 PDT = 15:00Z.
    expect(isQuietHours(new Date("2026-03-08T14:59:00Z"), LA)).toBe(true);
    expect(isQuietHours(new Date("2026-03-08T15:00:00Z"), LA)).toBe(false);
  });

  it("Vancouver is UTC−7 all winter (tzdata 2026b): 08:00 = 15:00Z, 22:00 = 05:00Z", () => {
    expect(isQuietHours(new Date("2026-12-05T14:59:00Z"), VANCOUVER)).toBe(true);
    expect(isQuietHours(new Date("2026-12-05T15:00:00Z"), VANCOUVER)).toBe(false);
    expect(isQuietHours(new Date("2026-12-06T04:59:00Z"), VANCOUVER)).toBe(false);
    expect(isQuietHours(new Date("2026-12-06T05:00:00Z"), VANCOUVER)).toBe(true);
  });
});

describe("dueReminders (who, and when)", () => {
  const due = (n: ReminderNight, now: Date, o: Partial<Parameters<typeof dueReminders>[0]> = {}) =>
    dueReminders({ now, nights: [n], members: MEMBERS, notYetVoted: new Map(), rsvps: new Map(), ...o }).map(
      (d) => `${d.kind}:${d.userId}`,
    );
  // Fri 13:00 New York, inside every window below and not quiet.
  const FRI_1PM = new Date("2026-11-13T18:00:00Z");

  it("voting closes soon: only active members who haven't voted, inside the window", () => {
    // Voting closes Fri 15:00 New York, so both edges are in the daytime.
    const n = night({ lockAt: plus(FRI_1PM, 2) });
    const notYetVoted = new Map([["n1", new Set(["m-ana"])]]);
    expect(due(n, FRI_1PM, { notYetVoted })).toEqual(["voting_closes:u-ana"]);
    // Window edges: opens at lock − 24h, closed from lock − 1h.
    expect(due(n, plus(n.lockAt, -24), { notYetVoted })).toEqual(["voting_closes:u-ana"]);
    expect(due(n, plus(n.lockAt, -24.01), { notYetVoted })).toEqual([]);
    expect(due(n, plus(n.lockAt, -1), { notYetVoted })).toEqual([]);
  });

  it("tonight: everyone not RSVP'd no, on a locked night", () => {
    const n = night({ state: "locked", scheduledAt: plus(FRI_1PM, 7) });
    const rsvps = new Map([["n1", new Map<string, "yes" | "no">([["m-ana", "yes"], ["m-ben", "no"]])]]);
    expect(due(n, FRI_1PM, { rsvps })).toEqual(["tonight:u-pia", "tonight:u-ana"]);
  });

  it("did you watch it: yes-RSVPs only, on a locked night, inside the window", () => {
    const n = night({ state: "locked", confirmableAt: plus(FRI_1PM, -1), unconfirmAt: plus(FRI_1PM, 40) });
    const rsvps = new Map([["n1", new Map<string, "yes" | "no">([["m-ana", "yes"], ["m-ben", "no"]])]]);
    const kinds = due(n, FRI_1PM, { rsvps }).filter((k) => k.startsWith("did_you_watch"));
    expect(kinds).toEqual(["did_you_watch:u-ana"]);
    expect(due(n, plus(n.unconfirmAt, -6), { rsvps }).filter((k) => k.startsWith("did_you_watch"))).toEqual([]);
  });

  it("your turn: the picker only, on a draft, until autoPassAt − 6h", () => {
    const n = night({ state: "draft", autoPassAt: plus(FRI_1PM, 10) });
    expect(due(n, FRI_1PM)).toEqual(["your_turn:u-pia"]);
    expect(due(n, plus(n.autoPassAt, -6))).toEqual([]);
  });

  it("nothing in quiet hours; it waits for 08:00 while the window is open", () => {
    const n = night({ state: "draft", autoPassAt: new Date("2026-11-15T01:00:00Z") });
    expect(due(n, new Date("2026-11-14T03:30:00Z"))).toEqual([]); // 22:30 NY
    expect(due(n, new Date("2026-11-14T13:00:00Z"))).toEqual(["your_turn:u-pia"]); // 08:00 NY
  });

  it("nobody with reminders off, the club muted, or who has left", () => {
    const n = night({ state: "locked", scheduledAt: plus(FRI_1PM, 7) });
    const members = [
      member("pia", { emailReminders: false }),
      member("ana", { remindersMutedAt: new Date() }),
      member("ben", { leftAt: new Date() }),
      member("cal"),
    ];
    expect(due(n, FRI_1PM, { members })).toEqual(["tonight:u-cal"]);
  });
});

describe("planReminders (the budget, priority and merging)", () => {
  const NOW = new Date("2026-11-13T18:00:00Z");
  const item = (kind: DueReminder["kind"], clubId: string, o: Partial<DueReminder> = {}): DueReminder => ({
    kind,
    userId: "u-ana",
    membershipId: `m-ana-${clubId}`,
    nightId: `night-${clubId}`,
    night: night({ clubId, nightId: `night-${clubId}`, clubName: `Club ${clubId}` }),
    ...o,
  });
  const plan = (due: DueReminder[], history: Parameters<typeof planReminders>[0]["history"] = []) =>
    planReminders({ now: NOW, due, history }).map((e) => `${e.kind}:${e.items.map((i) => i.night.clubId).join("+")}`);

  it("the first two that apply win, across three clubs; the rest are dropped", () => {
    expect(plan([item("did_you_watch", "C"), item("tonight", "B"), item("voting_closes", "A")])).toEqual([
      "voting_closes:A",
      "tonight:B",
    ]);
  });

  it("a slot freed because they already voted goes to the fill-in", () => {
    expect(plan([item("did_you_watch", "C"), item("tonight", "B")])).toEqual(["tonight:B", "did_you_watch:C"]);
  });

  it("the same kind in several clubs is one email, counting once", () => {
    expect(plan([item("voting_closes", "A"), item("voting_closes", "B"), item("tonight", "C")])).toEqual([
      "voting_closes:A+B",
      "tonight:C",
    ]);
  });

  it("the rolling 7 days: sends in the window count (one per email), older ones don't", () => {
    const sent = (sendId: string, hoursAgo: number, kind: DueReminder["kind"] = "tonight") => ({
      userId: "u-ana",
      kind,
      nightId: `old-${sendId}`,
      sendId,
      sentAt: plus(NOW, -hoursAgo),
    });
    const due = [item("voting_closes", "A"), item("tonight", "B")];
    // One email (two rows, one send) 3 days ago: one slot left.
    expect(plan(due, [sent("s1", 72), { ...sent("s1", 72), nightId: "old-other" }])).toEqual(["voting_closes:A"]);
    // Two emails this week: nothing.
    expect(plan(due, [sent("s1", 72), sent("s2", 24)])).toEqual([]);
    // Older than 7 days: doesn't count.
    expect(plan(due, [sent("s1", 7 * 24 + 1), sent("s2", 8 * 24)])).toEqual(["voting_closes:A", "tonight:B"]);
  });

  it("your turn is the picker's extra: always, outside the budget, and never counting toward it", () => {
    const full = [
      { userId: "u-ana", kind: "tonight" as const, nightId: "x1", sendId: "s1", sentAt: plus(NOW, -24) },
      { userId: "u-ana", kind: "tonight" as const, nightId: "x2", sendId: "s2", sentAt: plus(NOW, -48) },
    ];
    expect(plan([item("your_turn", "A"), item("tonight", "B")], full)).toEqual(["your_turn:A"]);
    const turnsOnly = [
      { userId: "u-ana", kind: "your_turn" as const, nightId: "y1", sendId: "s1", sentAt: plus(NOW, -24) },
      { userId: "u-ana", kind: "your_turn" as const, nightId: "y2", sendId: "s2", sentAt: plus(NOW, -48) },
    ];
    expect(plan([item("tonight", "B"), item("voting_closes", "A")], turnsOnly)).toEqual(["voting_closes:A", "tonight:B"]);
  });

  it("never twice: one already sent for that night and kind is skipped, whenever it was", () => {
    const history = [{ userId: "u-ana", kind: "voting_closes" as const, nightId: "night-A", sendId: "s1", sentAt: plus(NOW, -30 * 24) }];
    expect(plan([item("voting_closes", "A"), item("voting_closes", "B")], history)).toEqual(["voting_closes:B"]);
  });

  it("each person has their own budget", () => {
    const ben = (kind: DueReminder["kind"], clubId: string) => item(kind, clubId, { userId: "u-ben", membershipId: `m-ben-${clubId}` });
    const emails = planReminders({
      now: NOW,
      due: [item("voting_closes", "A"), item("tonight", "B"), item("did_you_watch", "C"), ben("did_you_watch", "C")],
      history: [],
    }).map((e) => `${e.userId}:${e.kind}`);
    expect(emails.sort()).toEqual(["u-ana:tonight", "u-ana:voting_closes", "u-ben:did_you_watch"]);
  });
});

describe("reminderContent", () => {
  const entry = (name: string) => ({
    clubName: name,
    clubUrl: `https://kinomato.test/clubs/${name.length}`,
    muteUrl: `https://kinomato.test/unsubscribe/mute-${name.length}`,
    when: "Fri 8:00pm",
  });
  const stop = "https://kinomato.test/unsubscribe/stop";

  it("plain and short: the unsubscribe line near the top, one link per club, the footer", () => {
    const c = reminderContent("voting_closes", [entry("Saturday Club")], stop);
    expect(c.subject).toBe("Voting closes soon in Saturday Club");
    expect(c.html.indexOf("Don't want these?")).toBeLessThan(c.html.indexOf("Voting closes Fri 8:00pm"));
    expect(c.html).toContain(`Don't want these? <a href="${stop}">Turn off reminders</a>`);
    expect(c.html).toContain("Voting closes Fri 8:00pm. You haven't voted yet.");
    expect(c.html).toContain('href="https://kinomato.test/clubs/13"');
    expect(c.html).toContain("At most two reminders a week across your clubs.");
    expect(c.html).toContain('href="https://kinomato.test/unsubscribe/mute-13">Mute only Saturday Club</a>');
    expect(c.text).toContain(`Don't want these? Turn off reminders: ${stop}`);
    expect(c.text).toContain("Mute only Saturday Club: https://kinomato.test/unsubscribe/mute-13");
    // No font-size on the top line: normal body size.
    expect(c.html.split("Turn off reminders")[0]).not.toMatch(/font-size/);
  });

  it("each kind's subject and line; several clubs in one", () => {
    expect(reminderContent("your_turn", [entry("A Club")], stop).subject).toBe("Your turn to pick for A Club");
    expect(reminderContent("your_turn", [entry("A Club")], stop).text).toContain(
      "Choose your films by Fri 8:00pm, or your turn passes to the next person.",
    );
    expect(reminderContent("tonight", [entry("A Club"), entry("Bee Club")], stop).subject).toBe("Movie night tonight: A Club and Bee Club");
    expect(reminderContent("did_you_watch", [entry("A Club"), entry("Bee Club"), entry("Cee Club")], stop).subject).toBe(
      "Did A Club, Bee Club and Cee Club meet?",
    );
    expect(reminderContent("did_you_watch", [entry("A Club")], stop).text).toContain(
      "Tell the club whether you watched it. If nobody answers by Fri 8:00pm, it's logged as unconfirmed.",
    );
  });

  it("escapes club names in the HTML", () => {
    const c = reminderContent("tonight", [entry('<b>"Bad" & Co</b>')], stop);
    expect(c.html).not.toContain("<b>");
    expect(c.html).toContain("&lt;b&gt;&quot;Bad&quot; &amp; Co&lt;/b&gt;");
  });
});
