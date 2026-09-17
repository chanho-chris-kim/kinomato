import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { clubs, films, memberships, nights, watchlistItems } from "@/db/schema";
import { formatRuntime } from "@/lib/format";
import { searchMovies } from "@/lib/tmdb";
import { buildShelves, type Shelf, type ShelfFilm } from "@/lib/watchlistShelves";
import { pickIdentity } from "../actions";
import { getIdentityMembershipId } from "../identity";
import { addFilm, removeFilm } from "./actions";

interface SearchRow {
  tmdbId: number;
  title: string;
  year: number;
  posterPath: string | null;
  director: string | null;
  cast: string[];
  genres: string[];
  runtime: number;
  otherMembersCount: number;
  alreadyWatched: boolean;
  onMyList: boolean;
}

export default async function WatchlistPage({
  params,
  searchParams,
}: {
  params: Promise<{ clubId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { clubId } = await params;
  const { q } = await searchParams;
  const query = q?.trim() ?? "";
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts

  const [club] = await db.select().from(clubs).where(eq(clubs.id, clubId));
  if (!club) {
    return <main className="p-4">Club not found.</main>;
  }

  const clubMemberships = await db
    .select()
    .from(memberships)
    .where(eq(memberships.clubId, clubId));
  const activeMemberships = clubMemberships.filter((m) => m.leftAt === null);

  const identityMembershipId = await getIdentityMembershipId(clubId);
  const currentMembership =
    activeMemberships.find((m) => m.id === identityMembershipId) ?? null;

  // No auth in v0 — a name picker is the whole identity flow, shared with
  // the club home page.
  if (!currentMembership) {
    return (
      <main className="p-4">
        <h1 className="text-xl font-bold">{club.name} — My watchlist</h1>
        <p className="mt-2">Who are you?</p>
        <ul className="mt-2 space-y-2">
          {activeMemberships.map((m) => (
            <li key={m.id}>
              <form action={pickIdentity.bind(null, clubId, m.id)}>
                <button type="submit" className="border px-3 py-1">
                  {m.displayName}
                </button>
              </form>
            </li>
          ))}
        </ul>
      </main>
    );
  }

  // My list, joined to the cached film data.
  const myItems = await db
    .select({
      watchlistItemId: watchlistItems.id,
      filmId: films.id,
      title: films.title,
      year: films.year,
      posterPath: films.posterPath,
      primaryGenre: films.primaryGenre,
      runtime: films.runtime,
    })
    .from(watchlistItems)
    .innerJoin(films, eq(watchlistItems.filmId, films.id))
    .where(eq(watchlistItems.membershipId, currentMembership.id));

  const myFilmIds = myItems.map((item) => item.filmId);
  const myFilmIdSet = new Set(myFilmIds);

  // Club-wide overlap count per film (including the viewer, who's
  // trivially one of the holders here — this feeds the "everyone wants
  // these" threshold, a different count than the search-result badge
  // below, which excludes the viewer).
  const clubOverlapRows = myFilmIds.length
    ? await db
        .select({ filmId: watchlistItems.filmId })
        .from(watchlistItems)
        .innerJoin(memberships, eq(watchlistItems.membershipId, memberships.id))
        .where(
          and(inArray(watchlistItems.filmId, myFilmIds), eq(memberships.clubId, clubId)),
        )
    : [];
  const clubOverlapCountByFilmId = new Map<string, number>();
  for (const row of clubOverlapRows) {
    clubOverlapCountByFilmId.set(row.filmId, (clubOverlapCountByFilmId.get(row.filmId) ?? 0) + 1);
  }

  const shelfFilms: ShelfFilm[] = myItems.map((item) => ({
    id: item.filmId,
    watchlistItemId: item.watchlistItemId,
    title: item.title,
    year: item.year,
    posterPath: item.posterPath,
    primaryGenre: item.primaryGenre,
    clubOverlapCount: clubOverlapCountByFilmId.get(item.filmId) ?? 0,
  }));
  const { smartShelves, genreShelves } = buildShelves(shelfFilms);

  const totalRuntime = myItems.reduce((sum, item) => sum + (item.runtime ?? 0), 0);

  // Search — title only this session (watchlist-spec.md §1.2's by-person/
  // by-keyword/URL/CSV modes aren't built yet).
  let searchRows: SearchRow[] = [];
  if (query) {
    const results = await searchMovies(query);
    const tmdbIds = results.map((r) => r.id);

    const existingFilms = tmdbIds.length
      ? await db.select().from(films).where(inArray(films.tmdbId, tmdbIds))
      : [];
    const filmByTmdbId = new Map(existingFilms.map((f) => [f.tmdbId, f]));
    const existingFilmIds = existingFilms.map((f) => f.id);

    const otherMemberRows = existingFilmIds.length
      ? await db
          .select({ filmId: watchlistItems.filmId, membershipId: watchlistItems.membershipId })
          .from(watchlistItems)
          .innerJoin(memberships, eq(watchlistItems.membershipId, memberships.id))
          .where(
            and(
              inArray(watchlistItems.filmId, existingFilmIds),
              eq(memberships.clubId, clubId),
            ),
          )
      : [];
    const otherCountByFilmId = new Map<string, number>();
    for (const row of otherMemberRows) {
      if (row.membershipId === currentMembership.id) continue;
      otherCountByFilmId.set(row.filmId, (otherCountByFilmId.get(row.filmId) ?? 0) + 1);
    }

    const watchedNights = existingFilmIds.length
      ? await db
          .select({ winningFilmId: nights.winningFilmId })
          .from(nights)
          .where(and(eq(nights.clubId, clubId), eq(nights.state, "watched")))
      : [];
    const watchedFilmIds = new Set(
      watchedNights.map((n) => n.winningFilmId).filter((id): id is string => id !== null),
    );

    searchRows = results.map((movie) => {
      const existing = filmByTmdbId.get(movie.id);
      const director =
        movie.credits.crew.find((c) => c.job === "Director")?.name ?? null;
      return {
        tmdbId: movie.id,
        title: movie.title,
        year: new Date(movie.release_date).getUTCFullYear(),
        posterPath: movie.poster_path,
        director,
        cast: movie.credits.cast.slice(0, 3).map((c) => c.name),
        genres: movie.genres.map((g) => g.name),
        runtime: movie.runtime,
        otherMembersCount: existing ? otherCountByFilmId.get(existing.id) ?? 0 : 0,
        alreadyWatched: existing ? watchedFilmIds.has(existing.id) : false,
        onMyList: existing ? myFilmIdSet.has(existing.id) : false,
      };
    });

    // Any film already on another club member's list floats to the top,
    // regardless of popularity (watchlist-spec.md §1.1). Stable sort
    // preserves the popularity order searchMovies() already returned
    // within each group.
    searchRows.sort(
      (a, b) => Number(b.otherMembersCount > 0) - Number(a.otherMembersCount > 0),
    );
  }

  return (
    <main className="p-4">
      <h1 className="text-xl font-bold">{club.name} — My watchlist</h1>
      <p className="mt-1">You are: {currentMembership.displayName}</p>

      <form className="mt-4">
        <input
          type="text"
          name="q"
          defaultValue={query}
          placeholder="Search films"
          className="border px-2 py-1"
        />
        <button type="submit" className="border px-3 py-1 ml-2">
          Search
        </button>
      </form>

      {query && (
        <section className="mt-4">
          <h2 className="font-semibold">Results for &quot;{query}&quot;</h2>
          {searchRows.length === 0 && <p className="mt-1">No results.</p>}
          <ul className="mt-2 space-y-3">
            {searchRows.map((r) => (
              <li key={r.tmdbId} className="border p-2 flex gap-3">
                <PosterPlaceholder className="w-11 h-16 shrink-0" />
                <div>
                  <div>
                    {r.title} ({r.year})
                  </div>
                  {r.director && <div className="text-sm">{r.director}</div>}
                  {r.cast.length > 0 && <div className="text-sm">{r.cast.join(", ")}</div>}
                  <div className="text-sm">
                    {r.genres.map((g) => (
                      <span key={g} className="border px-1 mr-1">
                        {g}
                      </span>
                    ))}
                  </div>
                  <div className="text-sm">{formatRuntime(r.runtime)}</div>
                  {r.otherMembersCount > 0 && (
                    <div className="text-sm">
                      {r.otherMembersCount} other{r.otherMembersCount === 1 ? "" : "s"} in your
                      club want this
                    </div>
                  )}
                  {r.alreadyWatched && <div className="text-sm">Club already watched this</div>}
                  <form action={addFilm.bind(null, clubId, r.tmdbId)}>
                    <button type="submit" className="border px-3 py-1 mt-1">
                      {r.onMyList ? "Added" : "Add"}
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-6">
        {myItems.length} films · {formatRuntime(totalRuntime)}
      </div>

      {smartShelves.map((shelf) => (
        <ShelfSection key={shelf.name} shelf={shelf} clubId={clubId} />
      ))}
      {genreShelves.map((shelf) => (
        <ShelfSection key={shelf.name} shelf={shelf} clubId={clubId} />
      ))}
    </main>
  );
}

// lib/tmdb.ts's fixture poster_path values are placeholders that don't
// resolve to anything — a real <img src> against them 404s, which is a
// real console error (browsers do log failed resource loads), not noise
// the E2E console-error fixture should ignore. Swap this for a real
// <img src={`https://image.tmdb.org/t/p/w92${posterPath}`}> once posters
// are real; needs images.remotePatterns in next.config.ts too.
function PosterPlaceholder({ className }: { className: string }) {
  return <div className={`bg-gray-200 ${className}`} />;
}

function ShelfSection({ shelf, clubId }: { shelf: Shelf; clubId: string }) {
  return (
    <div className="mt-4">
      <h3 className="font-semibold">
        {shelf.name} ({shelf.films.length})
      </h3>
      <div className="mt-1 flex flex-wrap gap-3">
        {shelf.films.map((f) => (
          <div key={f.watchlistItemId} className="w-24">
            <PosterPlaceholder className="w-24 h-36" />
            <div className="text-sm">
              {f.title} ({f.year})
            </div>
            <form action={removeFilm.bind(null, clubId, f.watchlistItemId)}>
              <button type="submit" className="text-sm underline">
                Remove
              </button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
