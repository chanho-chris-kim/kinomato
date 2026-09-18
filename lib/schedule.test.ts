import { describe, expect, it } from "vitest";
import { getNextOccurrence } from "./schedule";

const VANCOUVER = "America/Vancouver";

describe("getNextOccurrence", () => {
  describe("ad_hoc", () => {
    it("has no next occurrence", () => {
      const result = getNextOccurrence(
        { cadence: "ad_hoc", defaultDay: 6, defaultTime: "20:00", timezone: VANCOUVER },
        new Date("2026-06-01T00:00:00Z"),
        new Date("2026-01-01T00:00:00Z"),
      );
      expect(result).toBeNull();
    });

    it("has no next occurrence even without a day/time configured", () => {
      const result = getNextOccurrence(
        { cadence: "ad_hoc", defaultDay: null, defaultTime: null, timezone: VANCOUVER },
        new Date("2026-06-01T00:00:00Z"),
        new Date("2026-01-01T00:00:00Z"),
      );
      expect(result).toBeNull();
    });
  });

  describe("configuration errors", () => {
    it("throws for weekly with no default_day", () => {
      expect(() =>
        getNextOccurrence(
          { cadence: "weekly", defaultDay: null, defaultTime: "20:00", timezone: VANCOUVER },
          new Date(),
          new Date(),
        ),
      ).toThrow(/default_day/);
    });

    it("throws for weekly with no default_time", () => {
      expect(() =>
        getNextOccurrence(
          { cadence: "weekly", defaultDay: 6, defaultTime: null, timezone: VANCOUVER },
          new Date(),
          new Date(),
        ),
      ).toThrow(/default_time/);
    });
  });

  describe("weekly", () => {
    it("finds the next occurrence of the target weekday", () => {
      // 2026-03-02 is a Monday. Next Saturday (6) is 2026-03-07.
      const result = getNextOccurrence(
        { cadence: "weekly", defaultDay: 6, defaultTime: "20:00", timezone: VANCOUVER },
        new Date("2026-03-02T12:00:00Z"),
        new Date("2026-01-01T00:00:00Z"),
      );
      expect(result?.toISOString()).toBe("2026-03-08T04:00:00.000Z"); // Sat 20:00 PST (UTC-8)
    });

    it("returns today when today is the target weekday and the time hasn't passed", () => {
      // 2026-03-07 is a Saturday. "Now" is 10am local, target is 8pm local.
      const now = new Date("2026-03-07T18:00:00.000Z"); // 10:00 PST
      const result = getNextOccurrence(
        { cadence: "weekly", defaultDay: 6, defaultTime: "20:00", timezone: VANCOUVER },
        now,
        new Date("2026-01-01T00:00:00Z"),
      );
      expect(result?.toISOString()).toBe("2026-03-08T04:00:00.000Z"); // same day, 20:00 PST
    });

    it("rolls to next week when today is the target weekday but the time already passed", () => {
      // 2026-03-07 is a Saturday. "Now" is 10pm local, target (8pm) already passed.
      const now = new Date("2026-03-08T06:00:00.000Z"); // 22:00 PST on Mar 7
      const result = getNextOccurrence(
        { cadence: "weekly", defaultDay: 6, defaultTime: "20:00", timezone: VANCOUVER },
        now,
        new Date("2026-01-01T00:00:00Z"),
      );
      expect(result?.toISOString()).toBe("2026-03-15T03:00:00.000Z"); // next Sat 20:00 PDT (UTC-7)
    });

    it("gets the spring-forward transition right — same local 8pm on both sides", () => {
      // 2026-03-08 is the spring-forward day (2am -> 3am local, PST -> PDT).
      // 2026-03-02 is a Monday; next Sunday (0) is 2026-03-08.
      const result = getNextOccurrence(
        { cadence: "weekly", defaultDay: 0, defaultTime: "20:00", timezone: VANCOUVER },
        new Date("2026-03-02T12:00:00Z"),
        new Date("2026-01-01T00:00:00Z"),
      );
      // 20:00 local on the transition day is already PDT (UTC-7).
      expect(result?.toISOString()).toBe("2026-03-09T03:00:00.000Z");
    });

    it("gets the fall-back transition right — same local 8pm on both sides", () => {
      // 2026-11-01 is the fall-back day (2am -> 1am local, PDT -> PST).
      // 2026-10-26 is a Monday; next Sunday (0) is 2026-11-01.
      const result = getNextOccurrence(
        { cadence: "weekly", defaultDay: 0, defaultTime: "20:00", timezone: VANCOUVER },
        new Date("2026-10-26T12:00:00Z"),
        new Date("2026-01-01T00:00:00Z"),
      );
      // 20:00 local on the transition day is already PST (UTC-8).
      expect(result?.toISOString()).toBe("2026-11-02T04:00:00.000Z");
    });

    it("accepts a default_time with seconds (Postgres's time column format)", () => {
      const result = getNextOccurrence(
        { cadence: "weekly", defaultDay: 6, defaultTime: "20:00:00", timezone: VANCOUVER },
        new Date("2026-03-02T12:00:00Z"),
        new Date("2026-01-01T00:00:00Z"),
      );
      expect(result?.toISOString()).toBe("2026-03-08T04:00:00.000Z");
    });
  });

  describe("biweekly", () => {
    it("lands on the anchor's own occurrence when now is at or before it", () => {
      // Anchor (e.g. club creation) is 2026-01-05 (Monday); first Saturday
      // occurrence on/after that is 2026-01-10.
      const result = getNextOccurrence(
        { cadence: "biweekly", defaultDay: 6, defaultTime: "20:00", timezone: VANCOUVER },
        new Date("2026-01-06T00:00:00Z"), // just after anchor, well before the occurrence
        new Date("2026-01-05T00:00:00Z"),
      );
      expect(result?.toISOString()).toBe("2026-01-11T04:00:00.000Z"); // Sat Jan 10, 20:00 PST
    });

    it("steps forward in 14-day periods from the anchor's phase", () => {
      // Anchor occurrence: Sat Jan 10. Periods: Jan 10, Jan 24, Feb 7, Feb 21...
      // "now" is Feb 1 — the next period on/after that is Feb 7.
      const result = getNextOccurrence(
        { cadence: "biweekly", defaultDay: 6, defaultTime: "20:00", timezone: VANCOUVER },
        new Date("2026-02-01T12:00:00Z"),
        new Date("2026-01-05T00:00:00Z"),
      );
      expect(result?.toISOString()).toBe("2026-02-08T04:00:00.000Z"); // Sat Feb 7, 20:00 PST
    });

    it("does not drift onto the wrong weekday across the spring-forward transition", () => {
      // Anchor occurrence: Sat Feb 21, 2026. Periods: Feb 21, Mar 7, Mar 21 —
      // Mar 7 sits right before the Mar 8 transition, Mar 21 right after.
      const result = getNextOccurrence(
        { cadence: "biweekly", defaultDay: 6, defaultTime: "20:00", timezone: VANCOUVER },
        new Date("2026-03-10T00:00:00Z"), // after Mar 7's occurrence, before Mar 21's
        new Date("2026-02-16T00:00:00Z"), // a Monday; anchors to Sat Feb 21
      );
      expect(result?.toISOString()).toBe("2026-03-22T03:00:00.000Z"); // Sat Mar 21, 20:00 PDT
    });
  });

  describe("monthly", () => {
    it("finds the same Nth weekday of the next month", () => {
      // Anchor 2026-01-05 (Monday) -> first Saturday on/after is 2026-01-10,
      // the 2nd Saturday of January. "now" is after that occurrence (Jan 10
      // 20:00 PST = 2026-01-11T04:00:00Z) and rolls to the 2nd Saturday of
      // February, 2026-02-14.
      const result = getNextOccurrence(
        { cadence: "monthly", defaultDay: 6, defaultTime: "20:00", timezone: VANCOUVER },
        new Date("2026-01-12T00:00:00Z"),
        new Date("2026-01-05T00:00:00Z"),
      );
      expect(result?.toISOString()).toBe("2026-02-15T04:00:00.000Z"); // Sat Feb 14, 20:00 PST
    });

    it("returns the anchor month's own occurrence when now is before it", () => {
      const result = getNextOccurrence(
        { cadence: "monthly", defaultDay: 6, defaultTime: "20:00", timezone: VANCOUVER },
        new Date("2026-01-06T00:00:00Z"),
        new Date("2026-01-05T00:00:00Z"),
      );
      expect(result?.toISOString()).toBe("2026-01-11T04:00:00.000Z"); // Sat Jan 10
    });

    it("clamps to the last occurrence of the weekday when the Nth one doesn't exist that month", () => {
      // March 2026 has five Mondays (2, 9, 16, 23, 30). Anchor 2026-03-24
      // (a Tuesday) -> first Monday on/after is 2026-03-30, the 5th Monday
      // of March. April 2026 has only four Mondays (6, 13, 20, 27), so the
      // "5th Monday" target for April clamps to the 4th (last) Monday,
      // 2026-04-27, instead of skipping April entirely.
      const result = getNextOccurrence(
        { cadence: "monthly", defaultDay: 1, defaultTime: "20:00", timezone: VANCOUVER },
        new Date("2026-03-31T00:00:00Z"), // just after March's 5th Monday
        new Date("2026-03-24T00:00:00Z"),
      );
      expect(result?.toISOString()).toBe("2026-04-28T03:00:00.000Z"); // Mon Apr 27, 20:00 PDT
    });
  });
});
