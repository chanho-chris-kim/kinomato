import { describe, expect, it } from "vitest";
import { clubBadges } from "./watchlistBadges";

// The watchlist's search badges, one per club where they apply (ruled
// 2026-11-24, replacing Seen from): they name the club.
describe("clubBadges", () => {
  it("names the club: how many others there want it, and that it watched it", () => {
    expect(clubBadges([{ name: "Saturday Club", othersWant: 2, watched: true }])).toEqual([
      { kind: "overlap", text: "2 in Saturday Club want this" },
      { kind: "watched", text: "Saturday Club watched this" },
    ]);
  });

  it("one person is 'wants'", () => {
    expect(clubBadges([{ name: "Horror Sundays", othersWant: 1, watched: false }])).toEqual([
      { kind: "overlap", text: "1 in Horror Sundays wants this" },
    ]);
  });

  it("one per club where they apply, clubs by name; nothing for a club where neither does", () => {
    expect(
      clubBadges([
        { name: "Saturday Club", othersWant: 3, watched: false },
        { name: "Birch", othersWant: 0, watched: false },
        { name: "Apple", othersWant: 0, watched: true },
      ]),
    ).toEqual([
      { kind: "watched", text: "Apple watched this" },
      { kind: "overlap", text: "3 in Saturday Club want this" },
    ]);
  });

  it("no clubs, no badges", () => {
    expect(clubBadges([])).toEqual([]);
  });
});
