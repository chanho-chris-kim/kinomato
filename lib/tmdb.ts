// Live TMDB client. lib/tmdbFixture.ts holds a fixed ~25-film fixture
// with the identical shape, used by db/seed.ts directly (always — its
// hardcoded ids are fixture-only) and as this module's own fallback
// when TMDB_API_KEY isn't set (E2E/CI never set it, on purpose, so
// tests never need a key or real network access).
//
// Every exported type mirrors TMDB's actual response shapes — GET
// /movie/{id}?append_to_response=credits,keywords for the per-film
// shape, GET /search/movie for genre_ids and popularity.

import * as tmdbFixture from "./tmdbFixture";

export interface TmdbGenre {
  id: number;
  name: string;
}

export interface TmdbCastMember {
  id: number;
  name: string;
  character: string;
  order: number;
}

export interface TmdbCrewMember {
  id: number;
  name: string;
  job: string;
  department: string;
}

export interface TmdbKeyword {
  id: number;
  name: string;
}

export interface TmdbMovie {
  id: number;
  title: string;
  release_date: string; // YYYY-MM-DD
  poster_path: string | null;
  runtime: number;
  original_language: string;
  popularity: number;
  genres: TmdbGenre[];
  genre_ids: number[];
  credits: {
    cast: TmdbCastMember[];
    crew: TmdbCrewMember[];
  };
  keywords: {
    keywords: TmdbKeyword[];
  };
  keyword_ids: number[];
}

// The raw shape of a /search/movie hit — deliberately thinner than
// TmdbMovie (no runtime, credits, or keywords; the search endpoint
// doesn't return them). searchMovieCandidates() is what the watchlist
// screen's search actually calls, so it can check each candidate
// against the films cache before ever asking for the expensive detail
// call — searchMovies() below still returns the full TmdbMovie shape
// for anyone (or anything) that doesn't need cache-awareness.
export interface TmdbSearchCandidate {
  id: number;
  title: string;
  release_date: string;
  poster_path: string | null;
  popularity: number;
  genre_ids: number[];
}

const API_BASE = "https://api.themoviedb.org/3";
// Server-side only — never NEXT_PUBLIC_ (CLAUDE.md). v3 API key, sent
// as a query param, not the v4 read-access-token/Bearer-header form.
const API_KEY = process.env.TMDB_API_KEY;

// A search page is a disambiguation list, not an exhaustive result
// set — capping here bounds both the one search call and (for
// searchMovies()'s own enrichment loop) the N detail calls after it.
const MAX_SEARCH_RESULTS = 10;

async function tmdbFetch(path: string, params: Record<string, string>): Promise<unknown | null> {
  const url = new URL(`${API_BASE}${path}`);
  url.searchParams.set("api_key", API_KEY!);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const res = await fetch(url.toString());
  if (res.status === 404) return null; // "no such movie" — a normal, expected outcome
  if (!res.ok) {
    throw new Error(`TMDB request to ${path} failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function mapSearchResult(raw: {
  id: number;
  title: string;
  release_date?: string;
  poster_path: string | null;
  popularity?: number;
  genre_ids?: number[];
}): TmdbSearchCandidate {
  return {
    id: raw.id,
    title: raw.title,
    release_date: raw.release_date ?? "",
    poster_path: raw.poster_path ?? null,
    popularity: raw.popularity ?? 0,
    genre_ids: raw.genre_ids ?? [],
  };
}

export async function searchMovieCandidates(query: string): Promise<TmdbSearchCandidate[]> {
  const normalized = query.trim();
  if (!normalized) return [];
  if (!API_KEY) {
    const fixtureResults = await tmdbFixture.searchMovies(normalized);
    return fixtureResults.slice(0, MAX_SEARCH_RESULTS).map(mapSearchResult);
  }

  const data = (await tmdbFetch("/search/movie", { query: normalized })) as {
    results?: unknown[];
  } | null;
  const results = (data?.results ?? []) as Parameters<typeof mapSearchResult>[0][];
  return results.slice(0, MAX_SEARCH_RESULTS).map(mapSearchResult);
}

function mapMovieDetail(raw: {
  id: number;
  title: string;
  release_date?: string;
  poster_path: string | null;
  runtime?: number | null;
  original_language: string;
  popularity?: number;
  genres?: TmdbGenre[];
  credits?: { cast?: TmdbCastMember[]; crew?: TmdbCrewMember[] };
  keywords?: { keywords?: TmdbKeyword[] };
}): TmdbMovie {
  const genres = raw.genres ?? [];
  const keywordList = raw.keywords?.keywords ?? [];
  return {
    id: raw.id,
    title: raw.title,
    release_date: raw.release_date ?? "",
    poster_path: raw.poster_path ?? null,
    // A movie TMDB hasn't fully processed can have a null runtime; the
    // fixture's contract (and films.runtime's missing-data handling,
    // CLAUDE.md) already treats "unknown" as the safe default here.
    runtime: raw.runtime ?? 0,
    original_language: raw.original_language,
    popularity: raw.popularity ?? 0,
    genres,
    genre_ids: genres.map((g) => g.id),
    credits: {
      cast: raw.credits?.cast ?? [],
      crew: raw.credits?.crew ?? [],
    },
    keywords: { keywords: keywordList },
    keyword_ids: keywordList.map((k) => k.id),
  };
}

export async function getMovieById(id: number): Promise<TmdbMovie | null> {
  if (!API_KEY) return tmdbFixture.getMovieById(id);

  const data = await tmdbFetch(`/movie/${id}`, { append_to_response: "credits,keywords" });
  if (!data) return null;
  return mapMovieDetail(data as Parameters<typeof mapMovieDetail>[0]);
}

// Full TmdbMovie[] for every result, same contract this module has
// always had. Callers that care about not re-fetching an already-
// cached film (the watchlist screen's search) should use
// searchMovieCandidates() + getMovieById() directly instead, so they
// can skip the detail call for a cache hit — this composes the two
// unconditionally and is for callers that don't need that.
export async function searchMovies(query: string): Promise<TmdbMovie[]> {
  if (!API_KEY) return tmdbFixture.searchMovies(query);

  const candidates = await searchMovieCandidates(query);
  const enriched = await Promise.all(candidates.map((c) => getMovieById(c.id)));
  return enriched
    .filter((m): m is TmdbMovie => m !== null)
    .sort((a, b) => b.popularity - a.popularity);
}

// Pure mapping from TMDB's shape to films' insertable shape (db/schema.ts).
// No DB coupling here on purpose — both db/seed.ts (node postgres driver)
// and the app's server action (neon-http, via getDb()) call this with
// their own db instance, sharing this transform instead of duplicating it.
export function tmdbMovieToFilmRow(m: TmdbMovie) {
  return {
    tmdbId: m.id,
    title: m.title,
    year: new Date(m.release_date).getUTCFullYear(),
    runtime: m.runtime,
    posterPath: m.poster_path,
    genres: m.genres.map((g) => g.name),
    genreIds: m.genre_ids,
    directors: m.credits.crew.filter((c) => c.job === "Director").map((c) => c.name),
    cast: m.credits.cast.map((c) => c.name),
    keywords: m.keywords.keywords.map((k) => k.name),
    keywordIds: m.keyword_ids,
    primaryGenre: m.genres[0]?.name ?? null,
    originalLanguage: m.original_language,
    releaseDate: m.release_date,
  };
}
