import Form from "next/form";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { clubs, films, memberships, nights, watchlistItems } from "@/db/schema";
import { requireUser } from "@/app/auth";
import { GlobalShell } from "@/app/shell";
import { searchFilms } from "@/app/filmCache";
import { overlapByFilm } from "@/app/watchlistRead";
import { Poster } from "@/app/clubs/[clubId]/Poster";
import { formatRuntime } from "@/lib/format";
import { clubBadges } from "@/lib/watchlistBadges";
import { buildShelves, type Shelf } from "@/lib/watchlistShelves";
import { addToWatchlist, removeFromWatchlist } from "./actions";
import { RETIRED_SEEN_FROM_COOKIE } from "./seenFromCookie";

const PRIVACY = "Your clubs can see which films you've added, one film at a time, never your whole list.";

// The global watchlist (docs/onboarding-spec.md §6.4; rebuild step 6c): one
// list per person, the same in every club. Global level: Watchlist current,
// no club header or tabs, no rail at any width. No Seen from (removed
// 2026-11-24): each search badge names its club, one per club where it
// applies (lib/watchlistBadges.ts), and "Everyone wants these" counts a
// film's overlap in whichever of your clubs has the most. All counted
// through app/watchlistRead.ts; with no clubs there are none. An own-list
// file: it reads only the viewer's own watchlist_items rows.
export default async function WatchlistPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; seen?: string }>;
}) {
  const { q, seen } = await searchParams;
  const query = q?.trim() ?? "";
  const user = await requireUser("/watchlist");
  // An old ?seen= link, or a browser still holding the retired Seen from
  // cookie: once through the route that deletes it (a page can't), back to
  // plain /watchlist with the search kept.
  if (seen !== undefined || (await cookies()).has(RETIRED_SEEN_FROM_COOKIE)) {
    redirect(`/watchlist/forget-seen-from${query ? `?${new URLSearchParams({ q: query })}` : ""}`);
  }
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts

  const [myClubs, myItems] = await Promise.all([
    db
      .select({ id: clubs.id, name: clubs.name })
      .from(memberships)
      .innerJoin(clubs, eq(memberships.clubId, clubs.id))
      .where(and(eq(memberships.userId, user.id), isNull(memberships.leftAt)))
      .orderBy(asc(clubs.name)),
    db
      .select({
        filmId: films.id,
        title: films.title,
        year: films.year,
        posterPath: films.posterPath,
        primaryGenre: films.primaryGenre,
        runtime: films.runtime,
      })
      .from(watchlistItems)
      .innerJoin(films, eq(watchlistItems.filmId, films.id))
      .where(eq(watchlistItems.userId, user.id)),
  ]);

  const myFilmIds = myItems.map((i) => i.filmId);
  // Including you: feeds the "Everyone wants these" threshold, in the club
  // where the film has the most. No club, no overlap: every count is 0, so
  // that shelf never appears.
  const overlap = new Map<string, number>();
  for (const perClub of await Promise.all(myClubs.map((c) => overlapByFilm(db, c.id, myFilmIds)))) {
    for (const [filmId, n] of perClub) overlap.set(filmId, Math.max(overlap.get(filmId) ?? 0, n));
  }
  const { smartShelves, genreShelves } = buildShelves(
    myItems.map((i) => ({
      id: i.filmId,
      watchlistItemId: i.filmId,
      title: i.title,
      year: i.year,
      posterPath: i.posterPath,
      primaryGenre: i.primaryGenre,
      clubOverlapCount: overlap.get(i.filmId) ?? 0,
    })),
  );
  const totalRuntime = myItems.reduce((sum, i) => sum + (i.runtime ?? 0), 0);

  const results = query ? await searchFilms(db, query) : [];
  const resultIds = results.map((f) => f.id);
  const clubIds = myClubs.map((c) => c.id);
  const [othersByClub, watchedRows] =
    resultIds.length > 0 && clubIds.length > 0
      ? await Promise.all([
          Promise.all(myClubs.map((c) => overlapByFilm(db, c.id, resultIds, { excludeUserId: user.id }))),
          db
            .select({ clubId: nights.clubId, filmId: nights.winningFilmId })
            .from(nights)
            .where(and(inArray(nights.clubId, clubIds), eq(nights.state, "watched"))),
        ])
      : [[], []];
  const watched = new Set(watchedRows.map((r) => `${r.clubId}:${r.filmId}`));
  const badgesFor = (filmId: string) =>
    clubBadges(
      myClubs.map((c, i) => ({
        name: c.name,
        othersWant: othersByClub[i]?.get(filmId) ?? 0,
        watched: watched.has(`${c.id}:${filmId}`),
      })),
    );
  const wanted = (filmId: string) => othersByClub.some((m) => (m.get(filmId) ?? 0) > 0);
  const onMyList = new Set(myFilmIds);
  // Films already on someone's list in one of your clubs float to the top
  // (watchlist-spec.md §1.1); a stable sort keeps relevance within each group.
  const rows = [...results].sort((a, b) => Number(wanted(b.id)) - Number(wanted(a.id)));

  return (
    <GlobalShell current="watchlist">
      <h1 className="h-display mt14" style={{ fontSize: 24 }}>
        Your watchlist
      </h1>
      <p className="small muted" style={{ margin: "4px 0 0" }}>
        {PRIVACY}
      </p>

      <Form action="/watchlist" className="search mt14">
        <input
          type="text"
          name="q"
          defaultValue={query}
          placeholder="Search films"
          aria-label="Search films"
          autoFocus={myItems.length === 0}
        />
        <button type="submit" className="btn" style={{ width: "auto" }}>
          Search
        </button>
      </Form>

      {query && (
        <section className="mt20">
          <h2 className="sec">Results for &quot;{query}&quot;</h2>
          {rows.length === 0 && <p className="small muted mt-1">No results.</p>}
          <ul className="stack gap8 mt14">
            {rows.map((f) => {
              const badges = badgesFor(f.id);
              return (
                <li key={f.tmdbId} className="result">
                  <div className="thumb">
                    <Poster posterPath={f.posterPath} title={f.title} size={92} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="small">
                      {f.title} <span className="dim">({f.year})</span>
                    </div>
                    {f.directors[0] && <div className="tiny muted mt-1">{f.directors[0]}</div>}
                    {f.cast.length > 0 && <div className="tiny dim mt-1">{f.cast.slice(0, 3).join(", ")}</div>}
                    <div className="row gap6 mt-1" style={{ flexWrap: "wrap" }}>
                      {f.genres.map((g) => (
                        <span key={g} className="chip tiny">
                          {g}
                        </span>
                      ))}
                      <span className="chip tiny">{formatRuntime(f.runtime ?? 0)}</span>
                    </div>
                    {badges.map((b) => (
                      <p
                        key={b.text}
                        className={b.kind === "overlap" ? "tiny mt-1 overlap-badge" : "tiny dim mt-1 watched-badge"}
                      >
                        {b.text}
                      </p>
                    ))}
                    <form action={addToWatchlist.bind(null, f.tmdbId)} className="mt14">
                      <button type="submit" className="btn" style={{ width: "auto" }}>
                        {onMyList.has(f.id) ? "Added" : "Add"}
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {myItems.length === 0 ? (
        <div className="empty mt20">
          <p style={{ margin: "0 0 4px", color: "var(--fg)", fontSize: 15 }}>Your list is empty.</p>
          <p style={{ margin: 0 }}>
            Try <em>heat</em>, or a director.
          </p>
        </div>
      ) : (
        <>
          <p className="small muted mt20">
            {myItems.length} films · {formatRuntime(totalRuntime)}
          </p>
          {[...smartShelves, ...genreShelves].map((shelf) => (
            <ShelfSection key={shelf.name} shelf={shelf} />
          ))}
        </>
      )}
    </GlobalShell>
  );
}

function ShelfSection({ shelf }: { shelf: Shelf }) {
  return (
    <div className="mt20">
      <h3 className="sec">
        {shelf.name} ({shelf.films.length})
      </h3>
      <div className="grid3">
        {shelf.films.map((f) => (
          <div key={f.id} className="watchlist-item">
            <div className="poster">
              <Poster posterPath={f.posterPath} title={f.title} size={185} />
            </div>
            <div className="tiny">
              {f.title} <span className="dim">({f.year})</span>
            </div>
            <form action={removeFromWatchlist.bind(null, f.id)}>
              <button type="submit" className="tiny underline tap">
                Remove
              </button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
