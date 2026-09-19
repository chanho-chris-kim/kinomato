import { describe, expect, it } from "vitest";
import {
  getMovieById,
  searchMovieCandidates,
  searchMovies,
  tmdbMovieToFilmRow,
  type TmdbMovie,
} from "./tmdb";

// These exercise lib/tmdb.ts's own exports, not the fixture's — but
// since `npm test`/CI never sets TMDB_READ_TOKEN (CLAUDE.md: no real
// network access from unit tests), every call here takes the same
// fallback-to-fixture path a real, unconfigured deployment would. That
// makes this a real test of the fallback wiring itself, not just a
// duplicate of lib/tmdbFixture.test.ts's coverage.
describe("searchMovieCandidates (no TMDB_READ_TOKEN — fixture fallback)", () => {
  it("returns candidates for a fixture title", async () => {
    const results = await searchMovieCandidates("Whiplash");
    expect(results.map((c) => c.title)).toContain("Whiplash");
  });

  it("returns an empty array for an empty query", async () => {
    expect(await searchMovieCandidates("  ")).toEqual([]);
  });

  it("candidates have no runtime/credits/keywords — the thinner search shape", async () => {
    const [first] = await searchMovieCandidates("Whiplash");
    expect(first).not.toHaveProperty("runtime");
    expect(first).not.toHaveProperty("credits");
  });
});

describe("searchMovies (no TMDB_READ_TOKEN — fixture fallback)", () => {
  it("returns the full enriched shape, same contract as always", async () => {
    const [first] = await searchMovies("Whiplash");
    expect(first.title).toBe("Whiplash");
    expect(first.credits.cast.length).toBeGreaterThan(0);
  });
});

describe("getMovieById (no TMDB_READ_TOKEN — fixture fallback)", () => {
  it("returns a known fixture film", async () => {
    const movie = await getMovieById(1091); // The Thing
    expect(movie?.title).toBe("The Thing");
  });

  it("returns null for an id the fixture doesn't have", async () => {
    expect(await getMovieById(999999999)).toBeNull();
  });
});

describe("tmdbMovieToFilmRow", () => {
  it("maps every field the disambiguation table and shelf logic need", async () => {
    const movie = await getMovieById(10651); // Thief
    const row = tmdbMovieToFilmRow(movie as TmdbMovie);
    expect(row).toMatchObject({
      tmdbId: 10651,
      title: "Thief",
      year: 1981,
      runtime: 122,
      directors: ["Michael Mann"],
      primaryGenre: "Crime",
      originalLanguage: "en",
    });
    expect(row.cast).toContain("James Caan");
    expect(row.genreIds).toEqual([80, 18]);
    expect(row.keywordIds.length).toBeGreaterThan(0);
  });

  it("collects every director when a film has co-directors", async () => {
    const movie = await getMovieById(400005); // No Country for Old Men
    const row = tmdbMovieToFilmRow(movie as TmdbMovie);
    expect(row.directors).toEqual(["Joel Coen", "Ethan Coen"]);
  });

  it("uses the first genre as primary, matching lib/watchlistShelves.ts's placement rule", async () => {
    const movie = await getMovieById(400012); // Spirited Away: Animation, Family, Fantasy
    const row = tmdbMovieToFilmRow(movie as TmdbMovie);
    expect(row.primaryGenre).toBe("Animation");
  });
});
