import { describe, expect, it } from "vitest";
import { normalizeTag } from "./tags";

describe("normalizeTag", () => {
  it("trims leading and trailing whitespace", () => {
    expect(normalizeTag("  cozy  ")).toEqual({ name: "cozy", displayName: "cozy" });
  });

  it("lowercases the name but keeps original casing in displayName", () => {
    expect(normalizeTag("Cozy")).toEqual({ name: "cozy", displayName: "Cozy" });
  });

  it("collapses inner whitespace to a single space in both fields", () => {
    expect(normalizeTag("slow   burn")).toEqual({ name: "slow burn", displayName: "slow burn" });
  });

  it("collapses tabs and newlines too", () => {
    expect(normalizeTag("slow\t\nburn")).toEqual({ name: "slow burn", displayName: "slow burn" });
  });

  it("handles messy input combining all three", () => {
    expect(normalizeTag("  Slow    BURN  ")).toEqual({
      name: "slow burn",
      displayName: "Slow BURN",
    });
  });

  it("returns null for empty input", () => {
    expect(normalizeTag("")).toBeNull();
  });

  it("returns null for whitespace-only input", () => {
    expect(normalizeTag("   \t\n  ")).toBeNull();
  });
});
