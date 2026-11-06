import { describe, expect, it } from "vitest";
import { NO_CLUB_RULES, visibleToClub } from "./watchlistVisibility";

describe("visibleToClub", () => {
  const items = [
    { userId: "u1", filmId: "f1", extra: "kept as is" },
    { userId: "u2", filmId: "f1" },
    { userId: "u2", filmId: "f2" },
  ];

  // §6.2: no per-club hiding in v1, so a club sees every film on its
  // members' lists. The day this changes (per-club folders, §10) is a
  // deliberate edit to this test, not a quiet behaviour change.
  it("today, a club sees every item: returned unchanged, same order, same objects", () => {
    const visible = visibleToClub(items, "club-a", NO_CLUB_RULES);
    expect(visible).toEqual(items);
    visible.forEach((item, i) => expect(item).toBe(items[i]));
  });

  it("the same for any club", () => {
    expect(visibleToClub(items, "club-b", NO_CLUB_RULES)).toEqual(items);
  });

  it("nothing in, nothing out", () => {
    expect(visibleToClub([], "club-a", NO_CLUB_RULES)).toEqual([]);
  });
});
