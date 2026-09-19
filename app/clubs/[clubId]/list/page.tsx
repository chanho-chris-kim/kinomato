import { and, eq, inArray } from "drizzle-orm";
import Image from "next/image";
import { getDb } from "@/db";
import { clubs, films, memberships, nights, watchlistItems } from "@/db/schema";
import { formatRuntime } from "@/lib/format";
import { getMovieById, isValidFilmRow, searchMovieCandidates, tmdbMovieToFilmRow } from "@/lib/tmdb";
import { buildShelves, type Shelf, type ShelfFilm } from "@/lib/watchlistShelves";
import { pickIdentity } from "../actions";
import { ClubNav } from "../ClubNav";
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
        <ClubNav clubId={clubId} clubName={club.name} current="watchlist" />
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
    const candidates = await searchMovieCandidates(query);
    const tmdbIds = candidates.map((c) => c.id);

    const existingFilms = tmdbIds.length
      ? await db.select().from(films).where(inArray(films.tmdbId, tmdbIds))
      : [];
    const filmByTmdbId = new Map(existingFilms.map((f) => [f.tmdbId, f]));

    // Enrich only what isn't already cached — films.cached_at is kept
    // indefinitely (CLAUDE.md: "never re-fetch on browse"), so a repeat
    // search for something already added (by anyone) or previously
    // searched costs nothing beyond the one /search/movie call above.
    const uncachedIds = tmdbIds.filter((id) => !filmByTmdbId.has(id));
    if (uncachedIds.length > 0) {
      const freshMovies = await Promise.all(uncachedIds.map((id) => getMovieById(id)));
      for (const movie of freshMovies) {
        if (!movie) continue;
        // A single malformed TMDB result (CLAUDE.md — real example: a
        // stub search hit with no release_date, which NaNs films.year
        // and fails the insert) must never take down the whole search.
        // Caught per-candidate and logged server-side, not per-request —
        // the rest of the results still render.
        try {
          const filmRow = tmdbMovieToFilmRow(movie);
          if (!isValidFilmRow(filmRow)) {
            throw new Error(`unusable data from TMDB (year=${filmRow.year})`);
          }
          const [inserted] = await db
            .insert(films)
            .values(filmRow)
            .onConflictDoNothing({ target: films.tmdbId })
            .returning();
          // A concurrent search/add for the same film between our select
          // and this insert loses the race and gets nothing back — same
          // "re-read rather than fail" shape as addFilm's own race guard.
          const row =
            inserted ?? (await db.select().from(films).where(eq(films.tmdbId, movie.id)))[0];
          filmByTmdbId.set(movie.id, row);
        } catch (err) {
          // warn, not error — this is a handled, recovered condition
          // (the request itself still succeeds), not a crash. Matters
          // in dev specifically: Next.js replays a Server Component's
          // console.error to the browser console (a debugging aid),
          // which would otherwise trip the E2E suite's zero-tolerance
          // console-error fixture for something that isn't a bug.
          console.warn(
            `Skipping unusable search result (tmdbId=${movie.id}, title="${movie.title}"):`,
            err,
          );
        }
      }
    }

    const existingFilmIds = [...filmByTmdbId.values()].map((f) => f.id);

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

    // Built from the cached films row (whether it was already there or
    // just inserted above), not from the TMDB response directly — one
    // shape regardless of cache hit or miss.
    searchRows = candidates
      .map((c) => filmByTmdbId.get(c.id))
      .filter((f) => f !== undefined)
      .map((f) => ({
        tmdbId: f.tmdbId,
        title: f.title,
        year: f.year,
        posterPath: f.posterPath,
        director: f.directors[0] ?? null,
        cast: f.cast.slice(0, 3),
        genres: f.genres,
        runtime: f.runtime ?? 0,
        otherMembersCount: otherCountByFilmId.get(f.id) ?? 0,
        alreadyWatched: watchedFilmIds.has(f.id),
        onMyList: myFilmIdSet.has(f.id),
      }));

    // Any film already on another club member's list floats to the top,
    // regardless of popularity (watchlist-spec.md §1.1). Stable sort
    // preserves the relevance order searchMovieCandidates() returned
    // within each group.
    searchRows.sort(
      (a, b) => Number(b.otherMembersCount > 0) - Number(a.otherMembersCount > 0),
    );
  }

  return (
    <main className="p-4">
      <ClubNav clubId={clubId} clubName={club.name} current="watchlist" />
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
                <Poster
                  posterPath={r.posterPath}
                  title={r.title}
                  size={92}
                  className="w-11 h-16 shrink-0"
                />
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

// TMDB posters are a fixed 2:3 ratio at every size — width/height here
// are the intrinsic source dimensions next/image needs for layout, not
// the displayed size (the className's own w-*/h-* controls that, same
// as before this was a plain placeholder div). null posterPath (every
// fixture film, and any real film TMDB has no poster for) keeps the
// placeholder — a real <img>/<Image> against a path that doesn't
// resolve 404s, which is a real console error the E2E console-error
// fixture would correctly fail on, not noise to ignore.
function Poster({
  posterPath,
  title,
  size,
  className,
}: {
  posterPath: string | null;
  title: string;
  size: 92 | 185;
  className: string;
}) {
  if (!posterPath) return <div className={`bg-gray-200 ${className}`} />;
  return (
    <Image
      src={`https://image.tmdb.org/t/p/w${size}${posterPath}`}
      alt={`${title} poster`}
      width={size}
      height={Math.round(size * 1.5)}
      className={`${className} object-cover`}
    />
  );
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
            <Poster posterPath={f.posterPath} title={f.title} size={185} className="w-24 h-36" />
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
