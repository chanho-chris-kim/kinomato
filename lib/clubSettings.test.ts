import { describe, expect, it } from "vitest";
import { getNomineesPerTurn } from "./clubSettings";

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
