import { describe, expect, it } from "vitest";
import { areTakesRevealed, mustRateBeforeReveal } from "./ratingReveal";

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

describe("mustRateBeforeReveal", () => {
  const rsvps = [
    { membershipId: "a", status: "yes" as const },
    { membershipId: "b", status: "yes" as const },
    { membershipId: "c", status: "no" as const },
    { membershipId: "d", status: null },
    { membershipId: "gone", status: "yes" as const },
  ];

  it("is the explicit yes-RSVPs from members still active", () => {
    expect(mustRateBeforeReveal(rsvps, ["a", "b", "c", "d"])).toEqual(["a", "b"]);
  });

  it("drops a yes from someone who has left (2026-11-09 ruling)", () => {
    expect(mustRateBeforeReveal(rsvps, ["a", "b", "c", "d", "gone"])).toContain("gone");
    expect(mustRateBeforeReveal(rsvps, ["a", "b"])).not.toContain("gone");
  });

  it("no answer and no are never waited on, active or not", () => {
    expect(mustRateBeforeReveal(rsvps, ["c", "d"])).toEqual([]);
  });

  it("a departed attendee who never rated no longer blocks the reveal", () => {
    const rated = ["a", "b"];
    expect(areTakesRevealed(mustRateBeforeReveal(rsvps, ["a", "b", "gone"]), rated)).toBe(false);
    expect(areTakesRevealed(mustRateBeforeReveal(rsvps, ["a", "b"]), rated)).toBe(true);
  });

  it("someone leaving never un-reveals a night: the set only shrinks", () => {
    const rated = ["a", "b", "gone"];
    const before = areTakesRevealed(mustRateBeforeReveal(rsvps, ["a", "b", "gone"]), rated);
    for (const stillActive of [["a", "b"], ["a"], ["b"], []]) {
      expect(before).toBe(true);
      expect(areTakesRevealed(mustRateBeforeReveal(rsvps, stillActive), rated)).toBe(true);
    }
  });
});
