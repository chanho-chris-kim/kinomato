import { describe, expect, it } from "vitest";
import { chooseHelpFilms, chooseWantedFilms, HELP_FILM_LIMIT, needsHelp } from "./nominationHelp";

const film = (id: string, title: string, othersWant: number) => ({ id, title, othersWant });

describe("needsHelp (ruled 2026-11-17)", () => {
  it("when the picker has fewer nominatable films than nominees per turn, none included", () => {
    expect(needsHelp(0, 3)).toBe(true);
    expect(needsHelp(2, 3)).toBe(true);
    expect(needsHelp(3, 3)).toBe(false);
    expect(needsHelp(5, 3)).toBe(false);
    expect(needsHelp(0, 1)).toBe(true);
    expect(needsHelp(1, 1)).toBe(false);
  });
});

describe("chooseHelpFilms", () => {
  it("leaves out what's already on the picker's list", () => {
    const result = chooseHelpFilms([film("a", "Arrival", 2), film("b", "Babadook", 1)], new Set(["a"]));
    expect(result.map((f) => f.id)).toEqual(["b"]);
  });

  it("most wanted first, then by title", () => {
    const result = chooseHelpFilms(
      [film("z", "Zodiac", 1), film("a", "Arrival", 3), film("h", "Heat", 1), film("g", "Get Out", 3)],
      new Set(),
    );
    expect(result.map((f) => f.title)).toEqual(["Arrival", "Get Out", "Heat", "Zodiac"]);
  });

  it("at most six", () => {
    expect(HELP_FILM_LIMIT).toBe(6);
    const many = Array.from({ length: 10 }, (_, i) => film(String(i), `Film ${i}`, 10 - i));
    expect(chooseHelpFilms(many, new Set()).map((f) => f.id)).toEqual(["0", "1", "2", "3", "4", "5"]);
  });

  it("a film nobody else wants isn't offered", () => {
    expect(chooseHelpFilms([film("a", "Arrival", 0)], new Set())).toEqual([]);
  });
});

// "Wanted in {club}" on the welcome page (u3): the same candidates, most
// wanted first, at most six, but a film already on your list stays, so
// it can say "Added ✓".
describe("chooseWantedFilms", () => {
  const f = (id: string, othersWant: number, onMyList = false) => ({ id, title: id, othersWant, onMyList });
  it("most wanted first, then title; keeps your own additions; at most six; nobody wants it, it's out", () => {
    expect(
      chooseWantedFilms([f("b", 1), f("a", 1), f("c", 3, true), f("d", 0), f("e", 2)]).map((x) => x.id),
    ).toEqual(["c", "e", "a", "b"]);
    expect(chooseWantedFilms(Array.from({ length: 9 }, (_, i) => f(`f${i}`, 1)))).toHaveLength(6);
  });
});
