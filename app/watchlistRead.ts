import { and, eq, inArray, isNull } from "drizzle-orm";
import type { getDb } from "@/db";
import { films, memberships, watchlistItems } from "@/db/schema";
import { overlapByFilm as countOverlap } from "@/lib/watchlistOverlap";
import { NO_CLUB_RULES, visibleToClub } from "@/lib/watchlistVisibility";

// The one loader for what a club can see of its members' watchlists
// (CLAUDE.md "Which films a club can see goes through one function";
// docs/onboarding-spec.md §6). The only code that reads other people's
// watchlist_items — lib/watchlistAccess.test.ts fails if anything else
// does, apart from the own-list files, which read only the viewer's own
// rows. Every result here passes through lib/watchlistVisibility.ts's
// visibleToClub.
//
// Per-club folders (§6.2, §10), when they come: load the new table's rows
// here into ClubVisibilityRules (NO_CLUB_RULES today) and apply them in
// visibleToClub. Nothing that calls this file changes.
//
// Planned, not built: whoElseWants(db, clubId, filmId, viewerUserId) for a
// film's "who else in the club wants it, and when they added it" panel
// (watchlist-spec.md §3). It belongs here, built on clubVisibleItems, when
// the panel exists.

type Db = ReturnType<typeof getDb>;

// Every membership in the club, left ones too: lib/watchlistOverlap.ts
// decides who's active.
async function clubMembers(db: Db, clubId: string) {
  return db
    .select({ userId: memberships.userId, leftAt: memberships.leftAt })
    .from(memberships)
    .where(eq(memberships.clubId, clubId));
}

// Watchlist rows the club can see: its active members' lists, through
// visibleToClub. Optionally narrowed to some films or some people.
export async function clubVisibleItems(
  db: Db,
  clubId: string,
  narrow: { filmIds?: string[]; userIds?: string[] } = {},
): Promise<{ userId: string; filmId: string; addedAt: Date }[]> {
  const activeUserIds = (
    await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.clubId, clubId), isNull(memberships.leftAt)))
  ).map((m) => m.userId);
  const userIds = narrow.userIds ? activeUserIds.filter((id) => narrow.userIds!.includes(id)) : activeUserIds;
  if (userIds.length === 0 || narrow.filmIds?.length === 0) return [];

  const rows = await db
    .select({ userId: watchlistItems.userId, filmId: watchlistItems.filmId, addedAt: watchlistItems.addedAt })
    .from(watchlistItems)
    .where(
      and(
        inArray(watchlistItems.userId, userIds),
        narrow.filmIds ? inArray(watchlistItems.filmId, narrow.filmIds) : undefined,
      ),
    );
  // user_id is set on every row since the 6a backfill; NOT NULL in 6e.
  const owned = rows.filter((r): r is { userId: string; filmId: string; addedAt: Date } => r.userId !== null);
  return visibleToClub(owned, clubId, NO_CLUB_RULES);
}

// Club overlap per film (§6.3): distinct active members whose visible list
// has it. Shelves count everyone including you; the search badge passes
// excludeUserId to count others.
export async function overlapByFilm(
  db: Db,
  clubId: string,
  filmIds: string[],
  options: { excludeUserId?: string } = {},
): Promise<Map<string, number>> {
  if (filmIds.length === 0) return new Map();
  const [items, members] = await Promise.all([
    clubVisibleItems(db, clubId, { filmIds }),
    clubMembers(db, clubId),
  ]);
  return countOverlap(items, members, options);
}

// The films this person can nominate in this club: their own list, as the
// club can see it. Tonight's nominate picker and openVoting's server-side
// check both use it. (Hard limits will filter this further once they're
// wired in — the SEAM in app/clubs/[clubId]/actions.ts.)
export async function nominatableFilms(
  db: Db,
  clubId: string,
  userId: string,
): Promise<{ id: string; title: string; year: number }[]> {
  const items = await clubVisibleItems(db, clubId, { userIds: [userId] });
  if (items.length === 0) return [];
  const rows = await db
    .select({ id: films.id, title: films.title, year: films.year })
    .from(films)
    .where(inArray(films.id, items.map((i) => i.filmId)));
  // In the order they were added, oldest first.
  const addedAt = new Map(items.map((i) => [i.filmId, i.addedAt.getTime()]));
  return rows.sort((a, b) => addedAt.get(a.id)! - addedAt.get(b.id)!);
}

// An account's own watchlist, deleted whole: the §11.4 anonymisation
// (app/anonymise.ts). Returned unrun, for the caller's db.batch, so
// watchlist_items stays in this module and the own-list files.
export function deleteWatchlistOf(db: ReturnType<typeof getDb>, userId: string) {
  return db.delete(watchlistItems).where(eq(watchlistItems.userId, userId));
}

// Your own watchlist, for Download my data (docs/onboarding-spec.md §11.5):
// the viewer's own rows only, by user id, so no club visibility applies.
export async function ownWatchlist(db: Db, userId: string) {
  return db
    .select({
      title: films.title,
      year: films.year,
      addedAt: watchlistItems.addedAt,
      note: watchlistItems.note,
      tags: watchlistItems.tags,
    })
    .from(watchlistItems)
    .innerJoin(films, eq(watchlistItems.filmId, films.id))
    .where(eq(watchlistItems.userId, userId));
}
