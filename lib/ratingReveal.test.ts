import { describe, expect, it } from "vitest";
import { areTakesRevealed } from "./ratingReveal";

describe("areTakesRevealed", () => {
  it("stays hidden while at least one attending member hasn't rated", () => {
    expect(areTakesRevealed(["a", "b", "c"], ["a", "b"])).toBe(false);
  });

  it("reveals once every attending member has rated", () => {
    expect(areTakesRevealed(["a", "b", "c"], ["a", "b", "c"])).toBe(true);
  });

  it("reveals the moment the last attending member's rating lands", () => {
    // Same input as the "stays hidden" case, plus c's rating.
    expect(areTakesRevealed(["a", "b", "c"], ["a", "b", "c"])).toBe(true);
  });

  it("is vacuously revealed when nobody RSVP'd yes — nobody to wait on", () => {
    expect(areTakesRevealed([], [])).toBe(true);
    expect(areTakesRevealed([], ["a"])).toBe(true);
  });

  it("ignores a rating from someone who isn't attending", () => {
    // Picker RSVP'd no but rated anyway — doesn't count toward, or
    // substitute for, an attending member's own rating.
    expect(areTakesRevealed(["a", "b"], ["a", "picker-who-said-no"])).toBe(false);
  });

  it("is not fooled by duplicate entries in either list", () => {
    expect(areTakesRevealed(["a", "a", "b"], ["a", "b", "b"])).toBe(true);
  });
});
