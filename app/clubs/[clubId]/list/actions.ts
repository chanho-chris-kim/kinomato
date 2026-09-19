"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { films, watchlistItems } from "@/db/schema";
import { getMovieById, tmdbMovieToFilmRow } from "@/lib/tmdb";
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

  // Adding a film already on this member's list is a harmless no-op —
  // see the unique constraint on (membership_id, film_id).
  await db.insert(watchlistItems).values({ membershipId, filmId }).onConflictDoNothing();

  revalidatePath(`/clubs/${clubId}/list`);
}

export async function removeFilm(clubId: string, watchlistItemId: string) {
  const membershipId = await requireCurrentMembershipId(clubId);
  const db = getDb();

  // Scoped to the current membership so one member can't remove a film
  // off someone else's list via a crafted request.
  await db
    .delete(watchlistItems)
    .where(
      and(
        eq(watchlistItems.id, watchlistItemId),
        eq(watchlistItems.membershipId, membershipId),
      ),
    );

  revalidatePath(`/clubs/${clubId}/list`);
}
