import { describe, expect, it } from "vitest";
import { filterByAgeCeiling, type AgeCeilingFilm } from "./ageCeiling";

function film(id: string, certification: string | null): AgeCeilingFilm {
  return { id, certification };
}

describe("filterByAgeCeiling", () => {
  it("returns every film eligible when the club has no ceiling configured", () => {
    const result = filterByAgeCeiling({
      films: [film("g", "G"), film("r", "R"), film("unknown", null)],
      ceiling: null,
    });
    expect(result.eligible.map((f) => f.id)).toEqual(["g", "r", "unknown"]);
    expect(result.excluded).toEqual([]);
  });

  it("includes a film rated below the ceiling", () => {
    const result = filterByAgeCeiling({
      films: [film("g", "G")],
      ceiling: "PG-13",
    });
    expect(result.eligible.map((f) => f.id)).toEqual(["g"]);
  });

  it("includes a film rated exactly at the ceiling", () => {
    const result = filterByAgeCeiling({
      films: [film("pg13", "PG-13")],
      ceiling: "PG-13",
    });
    expect(result.eligible.map((f) => f.id)).toEqual(["pg13"]);
  });

  it("excludes a film rated above the ceiling", () => {
    const result = filterByAgeCeiling({
      films: [film("r", "R")],
      ceiling: "PG-13",
    });
    expect(result.eligible).toEqual([]);
    expect(result.excluded.map((f) => f.id)).toEqual(["r"]);
  });

  it("excludes a film with a null certification — missing data fails closed", () => {
    const result = filterByAgeCeiling({
      films: [film("unknown", null)],
      ceiling: "PG-13",
    });
    expect(result.eligible).toEqual([]);
    expect(result.excluded.map((f) => f.id)).toEqual(["unknown"]);
  });

  it("excludes a film with an unrecognized certification string — fails closed, same as unknown", () => {
    const result = filterByAgeCeiling({
      films: [film("unrated", "Not Rated")],
      ceiling: "PG-13",
    });
    expect(result.eligible).toEqual([]);
    expect(result.excluded.map((f) => f.id)).toEqual(["unrated"]);
  });

  it("filters correctly at the strictest ceiling", () => {
    const result = filterByAgeCeiling({
      films: [film("g", "G"), film("pg", "PG"), film("pg13", "PG-13")],
      ceiling: "G",
    });
    expect(result.eligible.map((f) => f.id)).toEqual(["g"]);
  });

  it("matches certification case-insensitively", () => {
    const result = filterByAgeCeiling({
      films: [film("lowercase", "pg-13")],
      ceiling: "PG-13",
    });
    expect(result.eligible.map((f) => f.id)).toEqual(["lowercase"]);
  });

  it("excludes everything when the ceiling itself is unrecognized — fails closed defensively", () => {
    const result = filterByAgeCeiling({
      films: [film("g", "G")],
      ceiling: "some-unmapped-country-rating",
    });
    expect(result.eligible).toEqual([]);
    expect(result.excluded.map((f) => f.id)).toEqual(["g"]);
  });
});
