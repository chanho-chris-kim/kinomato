"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { films, watchlistItems } from "@/db/schema";
import { getMovieById, tmdbMovieToFilmRow } from "@/lib/tmdb";
import { requireCurrentMembershipId } from "../identity";

// Adding a film that's never been searched by this club before caches it
// (one films row per tmdbId, cached indefinitely — watchlist-spec.md §5).
// Adding one that's already cached (another member searched it first, or
// it's already club history) refreshes that row instead of creating a
// second one — onConflictDoUpdate, keyed on the tmdb id.
export async function addFilm(clubId: string, tmdbId: number) {
  const membershipId = await requireCurrentMembershipId(clubId);
  const db = getDb();

  const movie = await getMovieById(tmdbId);
  if (!movie) {
    throw new Error(`No TMDB movie with id ${tmdbId}.`);
  }
  const filmRow = tmdbMovieToFilmRow(movie);

  const [film] = await db
    .insert(films)
    .values(filmRow)
    .onConflictDoUpdate({ target: films.tmdbId, set: filmRow })
    .returning({ id: films.id });

  // Adding a film already on this member's list is a harmless no-op —
  // see the unique constraint on (membership_id, film_id).
  await db.insert(watchlistItems).values({ membershipId, filmId: film.id }).onConflictDoNothing();

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
