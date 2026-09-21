import { describe, expect, it } from "vitest";
import { confirmableAt, isConfirmable } from "./confirmTiming";

const VANCOUVER = "America/Vancouver";
const NEW_YORK = "America/New_York";

describe("confirmableAt", () => {
  describe("same_night", () => {
    it("is scheduledAt itself — no delay", () => {
      const scheduledAt = new Date("2026-03-07T20:00:00-08:00");
      expect(confirmableAt("same_night", scheduledAt, VANCOUVER)).toEqual(scheduledAt);
    });
  });

  describe("morning_after", () => {
    it("is 9am local the following day", () => {
      // Sat Feb 7 2026, 8pm ET -> threshold Sun Feb 8, 9am ET.
      const scheduledAt = new Date("2026-02-07T20:00:00-05:00");
      const threshold = confirmableAt("morning_after", scheduledAt, NEW_YORK);
      expect(threshold?.toISOString()).toBe(new Date("2026-02-08T09:00:00-05:00").toISOString());
    });

    it("gets the spring-forward transition right — night in PST, morning in PDT", () => {
      // Sat Mar 7 2026, 8pm PST -> threshold Sun Mar 8, 9am — already PDT
      // by then (the 2am transition already happened).
      const scheduledAt = new Date("2026-03-07T20:00:00-08:00");
      const threshold = confirmableAt("morning_after", scheduledAt, VANCOUVER);
      expect(threshold?.toISOString()).toBe("2026-03-08T16:00:00.000Z");
    });

    it("gets the fall-back transition right — night in PDT, morning in PST", () => {
      // Sat Oct 31 2026, 8pm PDT -> threshold Sun Nov 1, 9am — already
      // PST by then.
      const scheduledAt = new Date("2026-10-31T20:00:00-07:00");
      const threshold = confirmableAt("morning_after", scheduledAt, VANCOUVER);
      expect(threshold?.toISOString()).toBe("2026-11-01T17:00:00.000Z");
    });
  });

  describe("manual_only", () => {
    it("has no threshold at all", () => {
      const scheduledAt = new Date("2026-03-07T20:00:00-08:00");
      expect(confirmableAt("manual_only", scheduledAt, VANCOUVER)).toBeNull();
    });
  });
});

describe("isConfirmable", () => {
  it("same_night: false before scheduledAt, true at or after", () => {
    const scheduledAt = new Date("2026-03-07T20:00:00-08:00");
    expect(
      isConfirmable("same_night", scheduledAt, VANCOUVER, new Date("2026-03-07T19:59:00-08:00")),
    ).toBe(false);
    expect(isConfirmable("same_night", scheduledAt, VANCOUVER, scheduledAt)).toBe(true);
  });

  it("morning_after: false right after the night, true once 9am next day arrives", () => {
    const scheduledAt = new Date("2026-02-07T20:00:00-05:00");
    // Just after the night ended, still the same evening — not yet.
    expect(
      isConfirmable("morning_after", scheduledAt, NEW_YORK, new Date("2026-02-07T23:00:00-05:00")),
    ).toBe(false);
    // 8am the next morning — still not yet (threshold is 9am).
    expect(
      isConfirmable("morning_after", scheduledAt, NEW_YORK, new Date("2026-02-08T08:00:00-05:00")),
    ).toBe(false);
    expect(
      isConfirmable("morning_after", scheduledAt, NEW_YORK, new Date("2026-02-08T09:00:00-05:00")),
    ).toBe(true);
  });

  it("manual_only: confirmable even before the night has happened", () => {
    const scheduledAt = new Date("2026-03-07T20:00:00-08:00");
    const wellBefore = new Date("2026-01-01T00:00:00Z");
    expect(isConfirmable("manual_only", scheduledAt, VANCOUVER, wellBefore)).toBe(true);
  });
});
