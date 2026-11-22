import { describe, expect, it } from "vitest";
import {
  AUTO_ADVANCE_HOURS,
  getAutoAdvance,
  getConfirmAt,
  getLockTime,
  getNomineesPerTurn,
  LOCK_TIME_HOURS,
  mergeClubSettings,
  readClubSettingsForm,
} from "./clubSettings";

describe("getNomineesPerTurn", () => {
  it("defaults to 3 when settings is empty", () => {
    expect(getNomineesPerTurn({})).toBe(3);
  });

  it("defaults to 3 when settings has no nomineesPerTurn key", () => {
    expect(getNomineesPerTurn({ cadence: "weekly" })).toBe(3);
  });

  it("reads an explicit value from settings", () => {
    expect(getNomineesPerTurn({ nomineesPerTurn: 5 })).toBe(5);
  });

  it("reads the documented minimum and maximum (1-5)", () => {
    expect(getNomineesPerTurn({ nomineesPerTurn: 1 })).toBe(1);
    expect(getNomineesPerTurn({ nomineesPerTurn: 5 })).toBe(5);
  });

  it("falls back to 3 for a value outside the documented 1-5 range", () => {
    expect(getNomineesPerTurn({ nomineesPerTurn: 0 })).toBe(3);
    expect(getNomineesPerTurn({ nomineesPerTurn: 6 })).toBe(3);
    expect(getNomineesPerTurn({ nomineesPerTurn: -1 })).toBe(3);
  });

  it("falls back to 3 for a non-integer value", () => {
    expect(getNomineesPerTurn({ nomineesPerTurn: 2.5 })).toBe(3);
  });

  it("falls back to 3 for a non-number value, rather than throwing", () => {
    expect(getNomineesPerTurn({ nomineesPerTurn: "3" })).toBe(3);
    expect(getNomineesPerTurn({ nomineesPerTurn: null })).toBe(3);
  });

  it("falls back to 3 for null, undefined, or a non-object settings value", () => {
    expect(getNomineesPerTurn(null)).toBe(3);
    expect(getNomineesPerTurn(undefined)).toBe(3);
    expect(getNomineesPerTurn("not an object")).toBe(3);
  });
});

describe("getConfirmAt", () => {
  it("defaults to morning_after when settings is empty", () => {
    expect(getConfirmAt({})).toBe("morning_after");
  });

  it("reads an explicit value from settings", () => {
    expect(getConfirmAt({ confirmAt: "same_night" })).toBe("same_night");
    expect(getConfirmAt({ confirmAt: "manual_only" })).toBe("manual_only");
    expect(getConfirmAt({ confirmAt: "morning_after" })).toBe("morning_after");
  });

  it("falls back to morning_after for an unimplemented documented value (2 days, off)", () => {
    // analysis-v2.md §2 documents five options; only three are built
    // this session (CLAUDE.md's Open Questions) — an unrecognized value
    // (including a genuinely documented-but-unbuilt one) falls back
    // rather than crashing the page.
    expect(getConfirmAt({ confirmAt: "2_days" })).toBe("morning_after");
    expect(getConfirmAt({ confirmAt: "off" })).toBe("morning_after");
  });

  it("falls back to morning_after for a non-string value, rather than throwing", () => {
    expect(getConfirmAt({ confirmAt: 1 })).toBe("morning_after");
    expect(getConfirmAt({ confirmAt: null })).toBe("morning_after");
  });

  it("falls back to morning_after for null, undefined, or a non-object settings value", () => {
    expect(getConfirmAt(null)).toBe("morning_after");
    expect(getConfirmAt(undefined)).toBe("morning_after");
    expect(getConfirmAt("not an object")).toBe("morning_after");
  });
});

const form = (o: Partial<Record<"nomineesPerTurn" | "confirmAt" | "lockTime" | "autoAdvance", unknown>>) => ({
  nomineesPerTurn: "3",
  confirmAt: "morning_after",
  lockTime: "24",
  autoAdvance: "48",
  ...o,
});

describe("readClubSettingsForm (write side: validated at settings-write time)", () => {
  it("accepts 1–5 films and the three implemented confirm timings", () => {
    expect(readClubSettingsForm(form({ nomineesPerTurn: "1", confirmAt: "same_night" }))).toEqual({
      ok: true,
      settings: { nomineesPerTurn: 1, confirmAt: "same_night", lockTime: 24, autoAdvance: 48 },
    });
    expect(readClubSettingsForm(form({ nomineesPerTurn: "5", confirmAt: "manual_only" }))).toEqual({
      ok: true,
      settings: { nomineesPerTurn: 5, confirmAt: "manual_only", lockTime: 24, autoAdvance: 48 },
    });
    expect(readClubSettingsForm(form({ nomineesPerTurn: " 3 ", confirmAt: "morning_after" }))).toMatchObject({ ok: true });
  });

  it("rejects anything else for films per turn, with a clear message", () => {
    for (const bad of ["0", "6", "2.5", "three", "", "-1", "1e1", null, undefined]) {
      expect(readClubSettingsForm(form({ nomineesPerTurn: bad, confirmAt: "same_night" })), String(bad)).toEqual({
        ok: false,
        error: "Films each picker nominates must be a whole number from 1 to 5.",
      });
    }
  });

  it("rejects an unimplemented or unknown confirm timing rather than storing it", () => {
    for (const bad of ["2_days", "off", "", "MORNING_AFTER", null]) {
      expect(readClubSettingsForm(form({ nomineesPerTurn: "3", confirmAt: bad })), String(bad)).toEqual({
        ok: false,
        error: "Pick when to ask whether you watched it.",
      });
    }
  });

  it("what it accepts reads back unchanged through the read side", () => {
    const written = readClubSettingsForm(form({ nomineesPerTurn: "2", confirmAt: "manual_only", lockTime: "3", autoAdvance: "168" }));
    if (!written.ok) throw new Error("expected ok");
    expect(getNomineesPerTurn(written.settings)).toBe(2);
    expect(getConfirmAt(written.settings)).toBe("manual_only");
    expect(getLockTime(written.settings)).toBe(3);
    expect(getAutoAdvance(written.settings)).toBe(168);
  });

  it("voting closes 1, 3, 6, 12, 24, 48 or 72 hours before the night; nothing else", () => {
    for (const ok of ["1", "3", "6", "12", "24", "48", "72"]) {
      expect(readClubSettingsForm(form({ lockTime: ok })), ok).toMatchObject({ ok: true, settings: { lockTime: Number(ok) } });
    }
    for (const bad of ["0", "2", "36", "96", "24.0", " ", "", "a day", null, undefined]) {
      expect(readClubSettingsForm(form({ lockTime: bad })), String(bad)).toEqual({ ok: false, error: "Pick when voting closes." });
    }
  });

  it("unconfirmed after 24, 48 or 168 hours; never \"never\"", () => {
    for (const ok of ["24", "48", "168"]) {
      expect(readClubSettingsForm(form({ autoAdvance: ok })), ok).toMatchObject({ ok: true, settings: { autoAdvance: Number(ok) } });
    }
    for (const bad of ["0", "never", "off", "72", "", null, undefined]) {
      expect(readClubSettingsForm(form({ autoAdvance: bad })), String(bad)).toEqual({
        ok: false,
        error: "Pick when to log a night nobody confirmed.",
      });
    }
  });
});

describe("getLockTime and getAutoAdvance (stored as hours)", () => {
  it("the allowed values", () => {
    expect(LOCK_TIME_HOURS).toEqual([1, 3, 6, 12, 24, 48, 72]);
    expect(AUTO_ADVANCE_HOURS).toEqual([24, 48, 168]);
  });

  it("default to 24 and 48 for a club that never set them", () => {
    expect(getLockTime({})).toBe(24);
    expect(getAutoAdvance({})).toBe(48);
    for (const bad of [null, undefined, "x", 5, []]) {
      expect(getLockTime(bad)).toBe(24);
      expect(getAutoAdvance(bad)).toBe(48);
    }
  });

  it("read a stored value, and fall back on anything not on the list", () => {
    expect(getLockTime({ lockTime: 72 })).toBe(72);
    expect(getAutoAdvance({ autoAdvance: 168 })).toBe(168);
    for (const bad of [0, 2, 25, "24", 24.5, null, -1]) {
      expect(getLockTime({ lockTime: bad }), String(bad)).toBe(24);
      expect(getAutoAdvance({ autoAdvance: bad }), String(bad)).toBe(48);
    }
  });
});

describe("mergeClubSettings", () => {
  it("replaces only the keys it writes and keeps any others", () => {
    expect(mergeClubSettings({ scheduleAnchor: "2026-01-10", nomineesPerTurn: 3 }, { nomineesPerTurn: 2, confirmAt: "same_night", lockTime: 6, autoAdvance: 24 })).toEqual({
      scheduleAnchor: "2026-01-10",
      nomineesPerTurn: 2,
      confirmAt: "same_night",
      lockTime: 6,
      autoAdvance: 24,
    });
    expect(mergeClubSettings(null, { nomineesPerTurn: 4, confirmAt: "morning_after", lockTime: 24, autoAdvance: 48 })).toEqual({
      nomineesPerTurn: 4,
      confirmAt: "morning_after",
      lockTime: 24,
      autoAdvance: 48,
    });
  });
});
