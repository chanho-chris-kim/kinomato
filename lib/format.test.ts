import { describe, expect, it } from "vitest";
import { describeSchedule, formatRuntime } from "./format";

describe("formatRuntime", () => {
  it("formats hours and minutes", () => {
    expect(formatRuntime(1300)).toBe("21h 40m");
  });

  it("formats exactly on the hour with no minutes shown", () => {
    expect(formatRuntime(120)).toBe("2h");
  });

  it("formats under an hour as minutes only", () => {
    expect(formatRuntime(45)).toBe("45m");
  });

  it("formats zero as 0m", () => {
    expect(formatRuntime(0)).toBe("0m");
  });

  it("rounds down fractional minutes", () => {
    expect(formatRuntime(90.9)).toBe("1h 30m");
  });
});

// The club header's schedule line (docs/onboarding-spec.md §5.10): one
// readable sentence from the club's own columns, nothing computed or
// guessed.
describe("describeSchedule", () => {
  const club = (over: Partial<Parameters<typeof describeSchedule>[0]> = {}) =>
    describeSchedule({
      cadence: "weekly",
      defaultDay: 6,
      defaultTime: "20:00",
      mode: "in_person",
      ...over,
    });

  it("weekly: plural weekday and the time", () => {
    expect(club()).toBe("Weekly, Saturdays at 8pm · In person");
  });

  it("every other week, and monthly (the Nth weekday — no N here, just the day)", () => {
    expect(club({ cadence: "biweekly" })).toBe("Every other Saturday at 8pm · In person");
    expect(club({ cadence: "monthly" })).toBe("Monthly, on a Saturday at 8pm · In person");
  });

  it("ad hoc has no standing night", () => {
    expect(club({ cadence: "ad_hoc", defaultDay: null, defaultTime: null, mode: "remote" })).toBe(
      "No fixed night · Remote",
    );
  });

  it("formats times the way people say them: minutes only when they're not :00", () => {
    expect(club({ defaultTime: "20:30" })).toBe("Weekly, Saturdays at 8:30pm · In person");
    expect(club({ defaultTime: "19:05:00" })).toBe("Weekly, Saturdays at 7:05pm · In person");
    expect(club({ defaultTime: "00:00" })).toBe("Weekly, Saturdays at 12am · In person");
    expect(club({ defaultTime: "12:00:00" })).toBe("Weekly, Saturdays at 12pm · In person");
  });

  it("leaves out what isn't set rather than inventing it", () => {
    expect(club({ defaultTime: null })).toBe("Weekly, Saturdays · In person");
    expect(club({ defaultDay: null })).toBe("Weekly at 8pm · In person");
    expect(club({ defaultDay: null, defaultTime: null })).toBe("Weekly · In person");
  });

  it("every weekday index maps to its name", () => {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    days.forEach((day, i) => {
      expect(club({ defaultDay: i, cadence: "biweekly" })).toBe(`Every other ${day} at 8pm · In person`);
    });
  });
});
