import { describe, expect, it } from "vitest";
import {
  autoPassAtFor,
  dueToAutoPass,
  dueToLock,
  dueToUnconfirm,
  effectiveLockAt,
  effectiveUnconfirmAt,
  lateConfirmOpen,
  LATE_CONFIRM_DAYS,
  lockAtFor,
  MIN_VOTING_HOURS,
  unconfirmAtFor,
} from "./nightDeadlines";
import { localDateParts } from "./schedule";

// Night deadlines (ruled 2026-11-21): stored on the night when voting
// opens (lock_at) and when it locks (unconfirm_at). Durations are absolute
// hours, so across a DST change they're 23/25 or 47/49 local hours.

const H = 3600_000;
const LOS_ANGELES = "America/Los_Angeles";
const VANCOUVER = "America/Vancouver";
const plus = (d: Date, hours: number) => new Date(d.getTime() + hours * H);
const localDate = (d: Date, tz: string) => localDateParts(d, tz);
const hourIn = (d: Date, tz: string) =>
  Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(d));

describe("lockAtFor (voting deadline, written when voting opens)", () => {
  // Sat 2026-11-14 20:00 in New York (UTC-5).
  const night = new Date("2026-11-15T01:00:00Z");

  it("is lockTime before the night when voting opens in good time", () => {
    expect(lockAtFor({ scheduledAt: night, now: plus(night, -72), lockTimeHours: 24 })).toEqual(plus(night, -24));
    expect(lockAtFor({ scheduledAt: night, now: plus(night, -72), lockTimeHours: 1 })).toEqual(plus(night, -1));
    expect(lockAtFor({ scheduledAt: night, now: plus(night, -100), lockTimeHours: 72 })).toEqual(plus(night, -72));
  });

  it(`gives everyone at least ${MIN_VOTING_HOURS} hours when voting opens late`, () => {
    expect(MIN_VOTING_HOURS).toBe(6);
    const now = plus(night, -20);
    expect(lockAtFor({ scheduledAt: night, now, lockTimeHours: 24 })).toEqual(plus(now, 6));
    // Exactly at the boundary: lockTime before the night is 6h from now.
    expect(lockAtFor({ scheduledAt: night, now: plus(night, -30), lockTimeHours: 24 })).toEqual(plus(night, -24));
  });

  it("never closes voting after the night starts", () => {
    expect(lockAtFor({ scheduledAt: night, now: plus(night, -3), lockTimeHours: 24 })).toEqual(night);
    expect(lockAtFor({ scheduledAt: night, now: plus(night, -6), lockTimeHours: 1 })).toEqual(night);
    // Opened after the night already started: due at once.
    expect(lockAtFor({ scheduledAt: night, now: plus(night, 2), lockTimeHours: 24 })).toEqual(night);
  });

  it("is absolute hours across a DST change (Los Angeles fall-back)", () => {
    // Sun 2026-11-01 20:00 PST = 04:00Z on the 2nd; 24h before is Sat 21:00
    // PDT: 23 hours on the clock.
    const sunday = new Date("2026-11-02T04:00:00Z");
    const lockAt = lockAtFor({ scheduledAt: sunday, now: plus(sunday, -72), lockTimeHours: 24 });
    expect(lockAt.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(hourIn(lockAt, LOS_ANGELES)).toBe(21);
    expect(localDate(lockAt, LOS_ANGELES).day).toBe(31);
  });
});

describe("autoPassAtFor (a draft nobody opened, ruled 2026-11-21)", () => {
  it("is when voting would have closed: lockTime before the night", () => {
    const night = new Date("2026-11-15T01:00:00Z");
    expect(autoPassAtFor({ scheduledAt: night, lockTimeHours: 24 })).toEqual(plus(night, -24));
    expect(autoPassAtFor({ scheduledAt: night, lockTimeHours: 3 })).toEqual(plus(night, -3));
  });
});

describe("unconfirmAtFor (written at lock)", () => {
  // Sat 2026-11-14 20:00 in New York (UTC-5); the next morning at 9 is
  // 14:00Z on the 15th.
  const night = new Date("2026-11-15T01:00:00Z");
  const NY = "America/New_York";
  const lockedEarly = plus(night, -24);

  it("counts autoAdvance from when the prompt appears (the next morning, by default)", () => {
    const at = unconfirmAtFor({ confirmAt: "morning_after", scheduledAt: night, timezone: NY, lockedAt: lockedEarly, autoAdvanceHours: 48 });
    expect(at.toISOString()).toBe("2026-11-17T14:00:00.000Z");
  });

  it("same night: from the night itself", () => {
    const at = unconfirmAtFor({ confirmAt: "same_night", scheduledAt: night, timezone: NY, lockedAt: lockedEarly, autoAdvanceHours: 24 });
    expect(at).toEqual(plus(night, 24));
  });

  it("manual only (no prompt gate): from the night itself", () => {
    const at = unconfirmAtFor({ confirmAt: "manual_only", scheduledAt: night, timezone: NY, lockedAt: lockedEarly, autoAdvanceHours: 168 });
    expect(at).toEqual(plus(night, 168));
  });

  it("from the lock, if voting closed after the prompt time", () => {
    const lateLock = plus(night, 20); // after 9am the next morning
    const at = unconfirmAtFor({ confirmAt: "morning_after", scheduledAt: night, timezone: NY, lockedAt: lateLock, autoAdvanceHours: 48 });
    expect(at).toEqual(plus(lateLock, 48));
    const manual = unconfirmAtFor({ confirmAt: "manual_only", scheduledAt: night, timezone: NY, lockedAt: plus(night, 2), autoAdvanceHours: 24 });
    expect(manual).toEqual(plus(night, 26));
  });

  it("is absolute hours across a DST change (Los Angeles spring-forward)", () => {
    // Sat 2026-03-07 20:00 PST = 04:00Z on the 8th. Same night + 24h is Sun
    // 21:00 PDT: 25 hours on the clock.
    const saturday = new Date("2026-03-08T04:00:00Z");
    const at = unconfirmAtFor({ confirmAt: "same_night", scheduledAt: saturday, timezone: LOS_ANGELES, lockedAt: plus(saturday, -24), autoAdvanceHours: 24 });
    expect(at.toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(hourIn(at, LOS_ANGELES)).toBe(21);
  });

  it("the next morning is 9am local on the far side of a fall-back (Los Angeles)", () => {
    // Sat 2026-10-31 20:00 PDT = 03:00Z Nov 1. The next morning is Sun 9am
    // PST = 17:00Z, and 48 hours on is Tue 9am PST.
    const saturday = new Date("2026-11-01T03:00:00Z");
    const at = unconfirmAtFor({ confirmAt: "morning_after", scheduledAt: saturday, timezone: LOS_ANGELES, lockedAt: plus(saturday, -24), autoAdvanceHours: 48 });
    expect(at.toISOString()).toBe("2026-11-03T17:00:00.000Z");
    expect(hourIn(at, LOS_ANGELES)).toBe(9);
  });

  it("Vancouver is UTC-7 all winter (tzdata 2026b): the next morning is 16:00Z", () => {
    // Sat 2026-12-05 20:00 in Vancouver = 03:00Z on the 6th.
    const saturday = new Date("2026-12-06T03:00:00Z");
    const at = unconfirmAtFor({ confirmAt: "morning_after", scheduledAt: saturday, timezone: VANCOUVER, lockedAt: plus(saturday, -24), autoAdvanceHours: 48 });
    expect(at.toISOString()).toBe("2026-12-08T16:00:00.000Z");
  });
});

describe("lateConfirmOpen (built later; ruled 2026-11-21)", () => {
  const unconfirmedAt = new Date("2026-11-17T14:00:00Z");
  const days = (n: number) => plus(unconfirmedAt, n * 24);

  it(`is open for ${LATE_CONFIRM_DAYS} days after the night became unconfirmed`, () => {
    expect(LATE_CONFIRM_DAYS).toBe(7);
    expect(lateConfirmOpen({ unconfirmedAt, now: unconfirmedAt, laterNightFinished: false })).toBe(true);
    expect(lateConfirmOpen({ unconfirmedAt, now: new Date(days(7).getTime() - 1), laterNightFinished: false })).toBe(true);
    expect(lateConfirmOpen({ unconfirmedAt, now: days(7), laterNightFinished: false })).toBe(false);
    expect(lateConfirmOpen({ unconfirmedAt, now: days(30), laterNightFinished: false })).toBe(false);
  });

  it("closes once a later night has finished", () => {
    expect(lateConfirmOpen({ unconfirmedAt, now: days(1), laterNightFinished: true })).toBe(false);
  });

  it("is never open for a night that wasn't marked unconfirmed", () => {
    expect(lateConfirmOpen({ unconfirmedAt: null, now: days(1), laterNightFinished: false })).toBe(false);
  });
});

// What the hourly job acts on (w3, ruled 2026-11-21). The stored deadline
// when there is one; for nights from before deadlines were stored, the
// same fallback Tonight shows.
describe("effectiveLockAt / effectiveUnconfirmAt (stored, or the fallback)", () => {
  const night = new Date("2026-11-15T01:00:00Z");
  const NY = "America/New_York";

  it("uses the stored lock_at; NULL falls back to lockTime before the night", () => {
    const stored = plus(night, -30);
    expect(effectiveLockAt({ lockAt: stored, scheduledAt: night, lockTimeHours: 24 })).toEqual(stored);
    expect(effectiveLockAt({ lockAt: null, scheduledAt: night, lockTimeHours: 12 })).toEqual(plus(night, -12));
  });

  it("uses the stored unconfirm_at; NULL is computed from locked_at (or the night)", () => {
    const stored = plus(night, 100);
    const base = { confirmAt: "same_night" as const, scheduledAt: night, timezone: NY, autoAdvanceHours: 48 };
    expect(effectiveUnconfirmAt({ ...base, unconfirmAt: stored, lockedAt: plus(night, -24) })).toEqual(stored);
    expect(effectiveUnconfirmAt({ ...base, unconfirmAt: null, lockedAt: plus(night, 5) })).toEqual(plus(night, 53));
    expect(effectiveUnconfirmAt({ ...base, unconfirmAt: null, lockedAt: null })).toEqual(plus(night, 48));
  });
});

describe("dueToLock (at most a few a run, oldest deadline first)", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  const open = (id: string, lockAt: Date | null, scheduledAt = plus(now, 48), lockTimeHours = 24) => ({
    id,
    lockAt,
    scheduledAt,
    lockTimeHours,
  });

  it("takes nights whose deadline has come, at or before now", () => {
    const due = dueToLock([open("a", plus(now, -1)), open("b", now), open("c", plus(now, 1))], now, 5);
    expect(due.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("a NULL lock_at is due once lockTime before the night has passed", () => {
    expect(dueToLock([open("old", null, plus(now, 23), 24)], now, 5).map((n) => n.id)).toEqual(["old"]);
    expect(dueToLock([open("old", null, plus(now, 25), 24)], now, 5)).toEqual([]);
  });

  it("caps the run, oldest deadline first, then id; the rest wait for the next run", () => {
    const nights = [3, 1, 6, 2, 5, 4, 7].map((h) => open(`n${h}`, plus(now, -h)));
    expect(dueToLock(nights, now, 5).map((n) => n.id)).toEqual(["n7", "n6", "n5", "n4", "n3"]);
    expect(dueToLock([open("b", plus(now, -1)), open("a", plus(now, -1))], now, 1).map((n) => n.id)).toEqual(["a"]);
  });
});

describe("dueToUnconfirm", () => {
  const NY = "America/New_York";
  const night = new Date("2026-11-15T01:00:00Z"); // Sat 8pm; next morning 9am = 14:00Z on the 15th
  const locked = (o: Partial<Parameters<typeof dueToUnconfirm>[0]> = {}) => ({
    unconfirmAt: plus(night, 61),
    confirmAt: "morning_after" as const,
    scheduledAt: night,
    timezone: NY,
    lockedAt: plus(night, -24),
    autoAdvanceHours: 48,
    ...o,
  });

  it("once unconfirm_at has come", () => {
    expect(dueToUnconfirm(locked(), plus(night, 61))).toBe(true);
    expect(dueToUnconfirm(locked(), plus(night, 60))).toBe(false);
  });

  it("never before the prompt has appeared, even if the stored deadline says so", () => {
    // A deadline stored before the club moved the prompt later.
    expect(dueToUnconfirm(locked({ unconfirmAt: plus(night, 1) }), plus(night, 2))).toBe(false);
    expect(dueToUnconfirm(locked({ unconfirmAt: plus(night, 1) }), plus(night, 13))).toBe(true);
  });

  it("a NULL unconfirm_at is computed the same way", () => {
    // Next morning (13h after the night) + 48h.
    expect(dueToUnconfirm(locked({ unconfirmAt: null }), plus(night, 60))).toBe(false);
    expect(dueToUnconfirm(locked({ unconfirmAt: null }), plus(night, 61))).toBe(true);
  });
});

describe("dueToAutoPass (a draft nobody opened)", () => {
  const night = new Date("2026-11-15T01:00:00Z");
  it("once voting would have closed", () => {
    expect(dueToAutoPass({ scheduledAt: night, lockTimeHours: 24 }, plus(night, -24))).toBe(true);
    expect(dueToAutoPass({ scheduledAt: night, lockTimeHours: 24 }, plus(night, -25))).toBe(false);
    expect(dueToAutoPass({ scheduledAt: night, lockTimeHours: 1 }, plus(night, 5))).toBe(true);
  });
});
