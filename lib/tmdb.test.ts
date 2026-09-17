import { describe, expect, it } from "vitest";
import { getMovieById, searchMovies, tmdbMovieToFilmRow, type TmdbMovie } from "./tmdb";

describe("searchMovies", () => {
  it("finds a film by a case-insensitive substring of its title", async () => {
    const results = await searchMovies("paddington");
    expect(results.map((m) => m.title)).toEqual(
      expect.arrayContaining(["Paddington", "Paddington 2"]),
    );
  });

  it("matches regardless of query case", async () => {
    const results = await searchMovies("HEAT");
    expect(results.map((m) => m.title)).toContain("Heat");
  });

  it("returns nothing for a query matching no title", async () => {
    const results = await searchMovies("xyzzy-not-a-real-film");
    expect(results).toEqual([]);
  });

  it("returns an empty array for an empty query rather than everything", async () => {
    const results = await searchMovies("   ");
    expect(results).toEqual([]);
  });

  it("sorts results by popularity, descending", async () => {
    const results = await searchMovies("paddington");
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].popularity).toBeGreaterThanOrEqual(results[i].popularity);
    }
  });
});

describe("getMovieById", () => {
  it("returns the full enriched movie for a known id", async () => {
    const movie = await getMovieById(1091); // The Thing
    expect(movie?.title).toBe("The Thing");
    expect(movie?.credits.crew.some((c) => c.job === "Director")).toBe(true);
    expect(movie?.keywords.keywords.length).toBeGreaterThan(0);
  });

  it("returns null for an unknown id", async () => {
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
