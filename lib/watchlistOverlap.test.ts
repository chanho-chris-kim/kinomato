import { describe, expect, it } from "vitest";
import { overlapByFilm } from "./watchlistOverlap";

const active = (userId: string) => ({ userId, leftAt: null });
const left = (userId: string) => ({ userId, leftAt: new Date("2026-10-01T00:00:00Z") });

describe("overlapByFilm (§6.3: distinct people among the club's active members)", () => {
  it("counts each active member whose list has the film", () => {
    const counts = overlapByFilm(
      [
        { userId: "a", filmId: "f1" },
        { userId: "b", filmId: "f1" },
        { userId: "b", filmId: "f2" },
      ],
      [active("a"), active("b")],
    );
    expect(counts.get("f1")).toBe(2);
    expect(counts.get("f2")).toBe(1);
    expect(counts.get("f3")).toBeUndefined();
  });

  it("a member who has left doesn't count", () => {
    const counts = overlapByFilm(
      [
        { userId: "a", filmId: "f1" },
        { userId: "gone", filmId: "f1" },
      ],
      [active("a"), left("gone")],
    );
    expect(counts.get("f1")).toBe(1);
  });

  it("someone who left and rejoined counts once", () => {
    const counts = overlapByFilm([{ userId: "back", filmId: "f1" }], [left("back"), active("back")]);
    expect(counts.get("f1")).toBe(1);
  });

  it("the same person never counts twice, even with duplicate rows", () => {
    const counts = overlapByFilm(
      [
        { userId: "a", filmId: "f1" },
        { userId: "a", filmId: "f1" },
      ],
      [active("a"), active("a")],
    );
    expect(counts.get("f1")).toBe(1);
  });

  it("someone not in the club at all doesn't count", () => {
    const counts = overlapByFilm([{ userId: "stranger", filmId: "f1" }], [active("a")]);
    expect(counts.get("f1")).toBeUndefined();
  });

  it("shelves count you; the search badge counts others (excludeUserId)", () => {
    const items = [
      { userId: "me", filmId: "f1" },
      { userId: "b", filmId: "f1" },
    ];
    const members = [active("me"), active("b")];
    expect(overlapByFilm(items, members).get("f1")).toBe(2);
    expect(overlapByFilm(items, members, { excludeUserId: "me" }).get("f1")).toBe(1);
  });
});
