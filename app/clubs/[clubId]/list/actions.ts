"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { films, watchlistItems } from "@/db/schema";
import { getMovieById, isValidFilmRow, tmdbMovieToFilmRow } from "@/lib/tmdb";
import { getSessionUserId } from "@/app/session";
import { requireCurrentMembershipId } from "../identity";

// Adding a film that's never been fetched before caches it (one films
// row per tmdbId, cached indefinitely — watchlist-spec.md §5, CLAUDE.md:
// "films don't change, never re-fetch on browse"). Adding one that's
// already cached (another member added it first, it surfaced from a
// search that already cached it, or it's already club history) reuses
// that row rather than calling TMDB again — no re-fetch, no rewrite.
export async function addFilm(clubId: string, tmdbId: number) {
  const membershipId = await requireCurrentMembershipId(clubId);
  const db = getDb();

  const [existing] = await db.select().from(films).where(eq(films.tmdbId, tmdbId));
  let filmId = existing?.id;

  if (!filmId) {
    const movie = await getMovieById(tmdbId);
    if (!movie) {
      throw new Error(`No TMDB movie with id ${tmdbId}.`);
    }
    const filmRow = tmdbMovieToFilmRow(movie);
    // Shouldn't be reachable through the UI — the search results page
    // already skips a candidate this malformed (CLAUDE.md) — but a
    // direct/stale call still deserves a clear error over a doomed
    // insert (films.year is NOT NULL).
    if (!isValidFilmRow(filmRow)) {
      throw new Error(`TMDB has unusable data for "${movie.title}" (id ${tmdbId}).`);
    }
    const [film] = await db
      .insert(films)
      .values(filmRow)
      .onConflictDoNothing({ target: films.tmdbId })
      .returning({ id: films.id });
    // onConflictDoNothing returns no row on a race (someone else's
    // concurrent add/search cached it between our select and insert) —
    // re-read rather than treat that as a failure, same shape as the
    // lazy-night-creation race in app/clubs/[clubId]/page.tsx.
    if (film) {
      filmId = film.id;
    } else {
      const [wonByOther] = await db.select().from(films).where(eq(films.tmdbId, tmdbId));
      filmId = wonByOther!.id;
    }
  }

  // Your one list (§6.1): keyed by the session's user. membership_id is
  // still dual-written until step 6e drops it. requireCurrentMembershipId
  // above already proved there's a session.
  const userId = (await getSessionUserId())!;

  // A film already on your list — added here or in any other club — is a
  // harmless no-op: the unique (user_id, film_id).
  await db
    .insert(watchlistItems)
    .values({ membershipId, userId, filmId })
    .onConflictDoNothing({ target: [watchlistItems.userId, watchlistItems.filmId] });

  revalidatePath(`/clubs/${clubId}/list`);
}

// Removing a film takes it off your one list, everywhere (§6.1). Scoped to
// the session's user, so nobody can remove a film from someone else's list
// with a crafted request.
export async function removeFilm(clubId: string, filmId: string) {
  await requireCurrentMembershipId(clubId);
  const userId = (await getSessionUserId())!;
  const db = getDb();

  await db
    .delete(watchlistItems)
    .where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.filmId, filmId)));

  revalidatePath(`/clubs/${clubId}/list`);
}
