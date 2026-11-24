"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { watchlistItems } from "@/db/schema";
import { requireUser } from "@/app/auth";
import { ensureFilm } from "@/app/filmCache";

// The global watchlist's actions (docs/onboarding-spec.md §6; rebuild step
// 6c). No club: your one list, keyed by (user_id, film_id). An own-list
// file (CLAUDE.md "Which films a club can see goes through one function"):
// it only ever touches the session user's own rows.

export async function addToWatchlist(tmdbId: number) {
  const user = await requireUser("/watchlist");
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const filmId = await ensureFilm(db, tmdbId);
  // Already on your list: a no-op.
  await db
    .insert(watchlistItems)
    .values({ userId: user.id, filmId })
    .onConflictDoNothing({ target: [watchlistItems.userId, watchlistItems.filmId] });
  // The whole layout, not just /watchlist: Tonight's "Films your club
  // wants" adds through here too, and its nomination list must follow.
  revalidatePath("/", "layout");
}

// Off your one list, everywhere.
export async function removeFromWatchlist(filmId: string) {
  const user = await requireUser("/watchlist");
  await getDb()
    .delete(watchlistItems)
    .where(and(eq(watchlistItems.userId, user.id), eq(watchlistItems.filmId, filmId)));
  revalidatePath("/watchlist");
}
