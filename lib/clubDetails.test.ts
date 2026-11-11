import { describe, expect, it } from "vitest";
import { checkFirstNight, firstNightRequired, readClubDetailsForm } from "./clubDetails";

const good = {
  name: "  Saturday Club ",
  cadence: "weekly",
  defaultDay: "6",
  defaultTime: "20:00",
  timezone: " America/Vancouver ",
  mode: "in_person",
};

describe("readClubDetailsForm (shared by /new and the edit form)", () => {
  it("accepts a valid club, trimmed", () => {
    expect(readClubDetailsForm(good, { allowAdHoc: true })).toEqual({
      ok: true,
      details: {
        name: "Saturday Club",
        cadence: "weekly",
        defaultDay: 6,
        defaultTime: "20:00",
        timezone: "America/Vancouver",
        mode: "in_person",
      },
    });
  });

  it("keeps /new's messages, in /new's order", () => {
    const cases: [Partial<typeof good>, string][] = [
      [{ name: "  " }, "Club name is required."],
      [{ cadence: "fortnightly" }, "Pick a valid cadence."],
      [{ mode: "outdoors" }, "Pick in-person or remote."],
      [{ defaultDay: "7" }, "Pick a day of the week."],
      [{ defaultDay: "1.5" }, "Pick a day of the week."],
      [{ defaultTime: "" }, "A default time is required."],
      [{ timezone: "Mars/Olympus" }, '"Mars/Olympus" isn\'t a recognized timezone, e.g. "America/New_York".'],
      [{ name: "", cadence: "bad" }, "Club name is required."],
    ];
    for (const [change, error] of cases) {
      expect(readClubDetailsForm({ ...good, ...change }, { allowAdHoc: true }), error).toEqual({ ok: false, error });
    }
  });

  it("a missing day reads as Sunday, as /new always has", () => {
    const result = readClubDetailsForm({ ...good, defaultDay: null }, { allowAdHoc: true });
    expect(result.ok && result.details.defaultDay).toBe(0);
  });

  it("/new allows no fixed schedule; the edit form doesn't, yet", () => {
    expect(readClubDetailsForm({ ...good, cadence: "ad_hoc" }, { allowAdHoc: true }).ok).toBe(true);
    expect(readClubDetailsForm({ ...good, cadence: "ad_hoc" }, { allowAdHoc: false })).toEqual({
      ok: false,
      error: "No fixed schedule can't be chosen until nights can be scheduled by hand.",
    });
  });
});

describe("firstNightRequired", () => {
  const weeklySat = { cadence: "weekly" as const, defaultDay: 6 };
  const biweeklySat = { cadence: "biweekly" as const, defaultDay: 6 };

  it("when a club becomes biweekly or monthly", () => {
    expect(firstNightRequired(weeklySat, biweeklySat)).toBe(true);
    expect(firstNightRequired(weeklySat, { cadence: "monthly", defaultDay: 6 })).toBe(true);
    expect(firstNightRequired({ cadence: "ad_hoc", defaultDay: 6 }, biweeklySat)).toBe(true);
  });

  it("when a biweekly or monthly club changes its day", () => {
    expect(firstNightRequired(biweeklySat, { cadence: "biweekly", defaultDay: 5 })).toBe(true);
    expect(firstNightRequired({ cadence: "monthly", defaultDay: 6 }, { cadence: "monthly", defaultDay: 0 })).toBe(true);
  });

  it("when switching between biweekly and monthly", () => {
    expect(firstNightRequired(biweeklySat, { cadence: "monthly", defaultDay: 6 })).toBe(true);
  });

  it("never for weekly, and not for a time or timezone change alone", () => {
    expect(firstNightRequired(biweeklySat, weeklySat)).toBe(false);
    expect(firstNightRequired(weeklySat, { cadence: "weekly", defaultDay: 2 })).toBe(false);
    expect(firstNightRequired(biweeklySat, biweeklySat)).toBe(false);
  });
});

describe("checkFirstNight", () => {
  // Wed 2026-11-11, 10:00 in Vancouver (UTC-7).
  const now = new Date("2026-11-11T17:00:00Z");
  const club = { defaultDay: 6, timezone: "America/Vancouver" };

  it("takes a date on the chosen weekday, today or later in the club's timezone", () => {
    expect(checkFirstNight("2026-11-14", club, now)).toEqual({ ok: true, date: "2026-11-14" });
    expect(checkFirstNight(" 2026-12-26 ", club, now)).toEqual({ ok: true, date: "2026-12-26" });
    // Today counts: a Wednesday club on a Wednesday.
    expect(checkFirstNight("2026-11-11", { ...club, defaultDay: 3 }, now)).toEqual({ ok: true, date: "2026-11-11" });
  });

  it("refuses a missing or unreadable date", () => {
    for (const bad of ["", null, "14/11/2026", "2026-02-30"]) {
      expect(checkFirstNight(bad, club, now), String(bad)).toEqual({ ok: false, error: "Pick the date of the first night." });
    }
  });

  it("refuses a date on another weekday, naming the right one", () => {
    expect(checkFirstNight("2026-11-13", club, now)).toEqual({ ok: false, error: "The first night has to be on a Saturday." });
  });

  it("refuses a date already past in the club's timezone", () => {
    expect(checkFirstNight("2026-11-07", club, now)).toEqual({ ok: false, error: "The first night can't be in the past." });
    // 23:30 UTC on the 11th is still the 11th in Vancouver, already the
    // 12th in Tokyo: a Wednesday the 11th is past there, not here.
    const late = new Date("2026-11-11T23:30:00Z");
    expect(checkFirstNight("2026-11-11", { defaultDay: 3, timezone: "America/Vancouver" }, late).ok).toBe(true);
    expect(checkFirstNight("2026-11-11", { defaultDay: 3, timezone: "Asia/Tokyo" }, late)).toEqual({
      ok: false,
      error: "The first night can't be in the past.",
    });
  });
});
