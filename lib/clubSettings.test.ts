import { describe, expect, it } from "vitest";
import { getConfirmAt, getNomineesPerTurn } from "./clubSettings";

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
