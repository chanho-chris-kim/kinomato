import { eq, inArray } from "drizzle-orm";
import type { getDb } from "@/db";
import { films } from "@/db/schema";
import { getMovieById, isValidFilmRow, searchMovieCandidates, tmdbMovieToFilmRow } from "@/lib/tmdb";

// The films cache (watchlist-spec.md §5; CLAUDE.md "film metadata caches
// indefinitely, never re-fetch on browse"): one films row per tmdbId.
// Shared by the global /watchlist's search and add. Touches only `films`.
// (/clubs/[id]/list still carries its own copy of this until rebuild step
// 6d retires that page.)

type Db = ReturnType<typeof getDb>;
export type FilmRow = typeof films.$inferSelect;

// A title search, every result cached as a films row, in TMDB's relevance
// order. Only uncached ids are fetched; a malformed result is skipped and
// logged, never taking down the rest.
export async function searchFilms(db: Db, query: string): Promise<FilmRow[]> {
  const candidates = await searchMovieCandidates(query);
  const tmdbIds = candidates.map((c) => c.id);
  const existing = tmdbIds.length ? await db.select().from(films).where(inArray(films.tmdbId, tmdbIds)) : [];
  const byTmdbId = new Map(existing.map((f) => [f.tmdbId, f]));

  const uncached = tmdbIds.filter((id) => !byTmdbId.has(id));
  const fresh = await Promise.all(uncached.map((id) => getMovieById(id)));
  for (const movie of fresh) {
    if (!movie) continue;
    try {
      const row = tmdbMovieToFilmRow(movie);
      if (!isValidFilmRow(row)) throw new Error(`unusable data from TMDB (year=${row.year})`);
      const [inserted] = await db.insert(films).values(row).onConflictDoNothing({ target: films.tmdbId }).returning();
      // Lost a race to a concurrent search or add: re-read, don't fail.
      byTmdbId.set(movie.id, inserted ?? (await db.select().from(films).where(eq(films.tmdbId, movie.id)))[0]);
    } catch (err) {
      // warn, not error: handled and recovered (the search still succeeds),
      // and Next replays a server console.error to the browser console.
      console.warn(`Skipping unusable search result (tmdbId=${movie.id}, title="${movie.title}"):`, err);
    }
  }
  return candidates.map((c) => byTmdbId.get(c.id)).filter((f): f is FilmRow => f !== undefined);
}

// The films row for a TMDB id, fetching and caching it the first time.
export async function ensureFilm(db: Db, tmdbId: number): Promise<string> {
  const [existing] = await db.select({ id: films.id }).from(films).where(eq(films.tmdbId, tmdbId));
  if (existing) return existing.id;
  const movie = await getMovieById(tmdbId);
  if (!movie) throw new Error(`No TMDB movie with id ${tmdbId}.`);
  const row = tmdbMovieToFilmRow(movie);
  if (!isValidFilmRow(row)) throw new Error(`TMDB has unusable data for "${movie.title}" (id ${tmdbId}).`);
  const [film] = await db.insert(films).values(row).onConflictDoNothing({ target: films.tmdbId }).returning({ id: films.id });
  if (film) return film.id;
  const [wonByOther] = await db.select({ id: films.id }).from(films).where(eq(films.tmdbId, tmdbId));
  return wonByOther!.id;
}
