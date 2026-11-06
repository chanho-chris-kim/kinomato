"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { memberships, watchlistItems } from "@/db/schema";
import { requireUser } from "@/app/auth";
import { ensureFilm } from "@/app/filmCache";
import { SEEN_FROM_COOKIE } from "./seenFromCookie";

// The global watchlist's actions (docs/onboarding-spec.md §6; rebuild step
// 6c). No club: your one list, keyed by (user_id, film_id). An own-list
// file (CLAUDE.md "Which films a club can see goes through one function"):
// it only ever touches the session user's own rows.

export async function addToWatchlist(tmdbId: number) {
  const user = await requireUser("/watchlist");
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const filmId = await ensureFilm(db, tmdbId);
  // No membership here: user_id only (membership_id is nullable since 6b).
  // Already on your list, from here or any club: a no-op.
  await db
    .insert(watchlistItems)
    .values({ userId: user.id, filmId })
    .onConflictDoNothing({ target: [watchlistItems.userId, watchlistItems.filmId] });
  revalidatePath("/watchlist");
}

// Off your one list, everywhere.
export async function removeFromWatchlist(filmId: string) {
  const user = await requireUser("/watchlist");
  await getDb()
    .delete(watchlistItems)
    .where(and(eq(watchlistItems.userId, user.id), eq(watchlistItems.filmId, filmId)));
  revalidatePath("/watchlist");
}

// A Seen from chip. Saved only if it's one of your active clubs; anything
// else is ignored. Back to plain /watchlist either way (a ?seen= preset
// never outlives its visit).
export async function setSeenFrom(formData: FormData) {
  const user = await requireUser("/watchlist");
  const clubId = String(formData.get("clubId") ?? "");
  const [mine] = /^[0-9a-f-]{36}$/i.test(clubId)
    ? await getDb()
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.userId, user.id), eq(memberships.clubId, clubId), isNull(memberships.leftAt)))
    : [];
  if (mine) {
    (await cookies()).set(SEEN_FROM_COOKIE, clubId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/watchlist",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  redirect("/watchlist");
}
