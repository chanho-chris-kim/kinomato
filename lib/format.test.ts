import { describe, expect, it } from "vitest";
import { formatRuntime } from "./format";

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
