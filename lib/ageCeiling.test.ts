import { describe, expect, it } from "vitest";
import {
  filterByAgeCeiling,
  isValidCeiling,
  type AgeCeilingFilm,
} from "./ageCeiling";

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

  it("excludes a film with a null certification — a fact about the film fails closed", () => {
    const result = filterByAgeCeiling({
      films: [film("unknown", null)],
      ceiling: "PG-13",
    });
    expect(result.eligible).toEqual([]);
    expect(result.excluded.map((f) => f.id)).toEqual(["unknown"]);
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

  it("throws on an unrecognized ceiling — a configuration bug fails loud, not closed", () => {
    expect(() =>
      filterByAgeCeiling({
        films: [film("g", "G")],
        ceiling: "some-unmapped-country-rating",
      }),
    ).toThrow(/unrecognized age-rating ceiling/i);
  });

  it("throws on a film with a non-null certification in an unmapped scheme", () => {
    expect(() =>
      filterByAgeCeiling({
        films: [film("uk-film", "15")], // BBFC, not MPAA
        ceiling: "PG-13",
      }),
    ).toThrow(/unmappable certification/i);
  });
});

describe("isValidCeiling", () => {
  it("accepts every MPAA rating", () => {
    for (const rating of ["G", "PG", "PG-13", "R", "NC-17"]) {
      expect(isValidCeiling(rating)).toBe(true);
    }
  });

  it("accepts case-insensitively, matching filterByAgeCeiling's own matching", () => {
    expect(isValidCeiling("pg-13")).toBe(true);
  });

  it("rejects an unrecognized value", () => {
    expect(isValidCeiling("15")).toBe(false);
    expect(isValidCeiling("Not Rated")).toBe(false);
  });
});
