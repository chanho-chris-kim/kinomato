import { describe, expect, it } from "vitest";
import { getAutoAdvance, getConfirmAt, getLockTime, getNomineesPerTurn, getShowVoteCounts } from "./clubSettings";
import { NEW_CLUB_DEFAULTS, readNewClubForm } from "./newClub";

// "Start your club" (u4): one form, validated by the same readers as the
// Members tab (lib/clubDetails.ts, lib/clubSettings.ts), so the two can
// never disagree. Defaults are today's, unchanged.
const NOW = new Date("2026-11-26T17:00:00Z"); // Thursday
const form = (o: Record<string, unknown> = {}) => ({
  name: "Fern's Film Club",
  cadence: "weekly",
  defaultDay: "6",
  defaultTime: "20:00",
  timezone: "America/New_York",
  mode: "in_person",
  nomineesPerTurn: "3",
  lockTime: "24",
  confirmAt: "morning_after",
  autoAdvance: "48",
  showVoteCounts: null,
  firstNightOn: null,
  ...o,
});

describe("NEW_CLUB_DEFAULTS", () => {
  it("are the readers' own defaults, unchanged", () => {
    expect(NEW_CLUB_DEFAULTS).toEqual({
      cadence: "weekly",
      defaultDay: 6,
      defaultTime: "20:00",
      mode: "in_person",
      nomineesPerTurn: getNomineesPerTurn({}),
      lockTime: getLockTime({}),
      confirmAt: getConfirmAt({}),
      autoAdvance: getAutoAdvance({}),
      showVoteCounts: getShowVoteCounts({}),
    });
  });
});

describe("readNewClubForm", () => {
  it("the defaults as sent are saved exactly, with a fresh getting-started list", () => {
    expect(readNewClubForm(form(), NOW)).toEqual({
      ok: true,
      details: {
        name: "Fern's Film Club",
        cadence: "weekly",
        defaultDay: 6,
        defaultTime: "20:00",
        timezone: "America/New_York",
        mode: "in_person",
      },
      settings: {
        nomineesPerTurn: 3,
        lockTime: 24,
        confirmAt: "morning_after",
        autoAdvance: 48,
        showVoteCounts: false,
        gettingStarted: { checked: false, hidden: false },
      },
    });
  });

  it("every setting as chosen", () => {
    const r = readNewClubForm(
      form({ nomineesPerTurn: "5", lockTime: "6", confirmAt: "same_night", autoAdvance: "168", showVoteCounts: "on", mode: "remote" }),
      NOW,
    );
    expect(r).toMatchObject({
      ok: true,
      details: { mode: "remote" },
      settings: { nomineesPerTurn: 5, lockTime: 6, confirmAt: "same_night", autoAdvance: 168, showVoteCounts: true },
    });
  });

  it("the details' errors and the settings' errors, as the Members tab gives them", () => {
    expect(readNewClubForm(form({ name: "  " }), NOW)).toEqual({ ok: false, error: "Club name is required." });
    expect(readNewClubForm(form({ timezone: "Mars/Olympus" }), NOW)).toMatchObject({ ok: false });
    expect(readNewClubForm(form({ nomineesPerTurn: "9" }), NOW)).toEqual({
      ok: false,
      error: "Films each picker nominates must be a whole number from 1 to 5.",
    });
    expect(readNewClubForm(form({ lockTime: "2" }), NOW)).toEqual({ ok: false, error: "Pick when voting closes." });
  });

  it("no fixed schedule isn't offered: the same rule as editing", () => {
    expect(readNewClubForm(form({ cadence: "ad_hoc" }), NOW)).toMatchObject({ ok: false });
  });

  it("every other week and monthly need a first night, on the day, not past; it's stored as the anchor", () => {
    expect(readNewClubForm(form({ cadence: "biweekly" }), NOW)).toEqual({ ok: false, error: "Pick the date of the first night." });
    expect(readNewClubForm(form({ cadence: "monthly", firstNightOn: "2026-11-27" }), NOW)).toEqual({
      ok: false,
      error: "The first night has to be on a Saturday.",
    });
    expect(readNewClubForm(form({ cadence: "biweekly", firstNightOn: "2026-11-21" }), NOW)).toEqual({
      ok: false,
      error: "The first night can't be in the past.",
    });
    expect(readNewClubForm(form({ cadence: "biweekly", firstNightOn: "2026-11-28" }), NOW)).toMatchObject({
      ok: true,
      settings: { scheduleAnchor: "2026-11-28" },
    });
    // Weekly ignores it.
    expect(readNewClubForm(form({ firstNightOn: "2026-11-28" }), NOW)).toMatchObject({ ok: true });
    const weekly = readNewClubForm(form({ firstNightOn: "2026-11-28" }), NOW);
    expect(weekly.ok && "scheduleAnchor" in weekly.settings).toBe(false);
  });
});
