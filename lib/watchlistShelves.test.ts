import { describe, expect, it } from "vitest";
import { buildShelves, type ShelfFilm } from "./watchlistShelves";

function film(id: string, overrides: Partial<ShelfFilm> = {}): ShelfFilm {
  return {
    id,
    watchlistItemId: `${id}-item`,
    title: id,
    year: 2000,
    posterPath: null,
    primaryGenre: "Drama",
    clubOverlapCount: 1,
    ...overrides,
  };
}

describe("buildShelves — genre shelves", () => {
  it("returns no shelves for an empty list", () => {
    const result = buildShelves([]);
    expect(result.genreShelves).toEqual([]);
    expect(result.smartShelves).toEqual([]);
  });

  it("collapses a single film into Everything else rather than its own genre shelf", () => {
    const result = buildShelves([film("a", { primaryGenre: "Horror" })]);
    expect(result.genreShelves).toEqual([
      { name: "Everything else", films: [film("a", { primaryGenre: "Horror" })] },
    ]);
  });

  it("keeps a genre as its own shelf once it has two or more films", () => {
    const a = film("a", { primaryGenre: "Horror" });
    const b = film("b", { primaryGenre: "Horror" });
    const result = buildShelves([a, b]);
    expect(result.genreShelves).toEqual([{ name: "Horror", films: [a, b] }]);
  });

  it("orders shelves by size, largest first", () => {
    const horror = [
      film("h1", { primaryGenre: "Horror" }),
      film("h2", { primaryGenre: "Horror" }),
      film("h3", { primaryGenre: "Horror" }),
    ];
    const comedy = [film("c1", { primaryGenre: "Comedy" }), film("c2", { primaryGenre: "Comedy" })];
    const result = buildShelves([...comedy, ...horror]);
    expect(result.genreShelves.map((s) => s.name)).toEqual(["Horror", "Comedy"]);
  });

  it("breaks a size tie alphabetically by genre name, for determinism", () => {
    const drama = [film("d1", { primaryGenre: "Drama" }), film("d2", { primaryGenre: "Drama" })];
    const comedy = [film("c1", { primaryGenre: "Comedy" }), film("c2", { primaryGenre: "Comedy" })];
    const result = buildShelves([...drama, ...comedy]);
    expect(result.genreShelves.map((s) => s.name)).toEqual(["Comedy", "Drama"]);
  });

  it("collects every singleton genre into one Everything else shelf, always last", () => {
    const horror = [
      film("h1", { primaryGenre: "Horror" }),
      film("h2", { primaryGenre: "Horror" }),
    ];
    const onlyComedy = film("c1", { primaryGenre: "Comedy" });
    const onlyDrama = film("d1", { primaryGenre: "Drama" });
    const result = buildShelves([...horror, onlyComedy, onlyDrama]);
    expect(result.genreShelves).toEqual([
      { name: "Horror", films: horror },
      { name: "Everything else", films: [onlyComedy, onlyDrama] },
    ]);
  });

  it("puts a film with no primary genre into Everything else", () => {
    const noGenre = film("n1", { primaryGenre: null });
    const horror = [
      film("h1", { primaryGenre: "Horror" }),
      film("h2", { primaryGenre: "Horror" }),
    ];
    const result = buildShelves([noGenre, ...horror]);
    expect(result.genreShelves).toEqual([
      { name: "Horror", films: horror },
      { name: "Everything else", films: [noGenre] },
    ]);
  });
});

describe("buildShelves — everyone wants these", () => {
  it("does not show the smart shelf when nothing qualifies", () => {
    const result = buildShelves([film("a", { clubOverlapCount: 1 })]);
    expect(result.smartShelves).toEqual([]);
  });

  it("does not show the smart shelf when only one film qualifies", () => {
    const result = buildShelves([
      film("a", { clubOverlapCount: 3 }),
      film("b", { clubOverlapCount: 1 }),
    ]);
    expect(result.smartShelves).toEqual([]);
  });

  it("shows the smart shelf once two or more films meet the three-list threshold", () => {
    const a = film("a", { clubOverlapCount: 3 });
    const b = film("b", { clubOverlapCount: 4 });
    const c = film("c", { clubOverlapCount: 1 });
    const result = buildShelves([a, b, c]);
    expect(result.smartShelves).toEqual([{ name: "Everyone wants these", films: [a, b] }]);
  });

  it("a film in the smart shelf still appears on its genre shelf too", () => {
    const a = film("a", { primaryGenre: "Horror", clubOverlapCount: 3 });
    const b = film("b", { primaryGenre: "Horror", clubOverlapCount: 3 });
    const result = buildShelves([a, b]);
    expect(result.smartShelves).toEqual([{ name: "Everyone wants these", films: [a, b] }]);
    expect(result.genreShelves).toEqual([{ name: "Horror", films: [a, b] }]);
  });
});
