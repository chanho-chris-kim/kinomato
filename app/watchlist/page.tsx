import Form from "next/form";
import { cookies } from "next/headers";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { clubs, films, memberships, nights, watchlistItems } from "@/db/schema";
import { requireUser } from "@/app/auth";
import { GlobalShell } from "@/app/shell";
import { searchFilms } from "@/app/filmCache";
import { overlapByFilm } from "@/app/watchlistRead";
import { Poster } from "@/app/clubs/[clubId]/Poster";
import { formatRuntime } from "@/lib/format";
import { resolveSeenFrom } from "@/lib/seenFrom";
import { buildShelves, type Shelf } from "@/lib/watchlistShelves";
import { addToWatchlist, removeFromWatchlist, setSeenFrom } from "./actions";
import { SEEN_FROM_COOKIE } from "./seenFromCookie";

const PRIVACY = "Your clubs can see which films you've added, one film at a time, never your whole list.";

// The global watchlist (docs/onboarding-spec.md §6.4; rebuild step 6c): one
// list per person, the same in every club. Global level: Watchlist current,
// no club header or tabs, no rail at any width. Badges and the "Everyone
// wants these" shelf are seen from one club (lib/seenFrom.ts), counted
// through app/watchlistRead.ts; with no clubs there are none. An own-list
// file: it reads only the viewer's own watchlist_items rows.
export default async function WatchlistPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; seen?: string }>;
}) {
  const { q, seen: seenParam } = await searchParams;
  const query = q?.trim() ?? "";
  const user = await requireUser("/watchlist");
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts

  const [myClubs, myItems, cookieStore] = await Promise.all([
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
    cookies(),
  ]);
  const { club: seenFrom, showChips } = resolveSeenFrom({
    clubs: myClubs,
    seenParam,
    cookie: cookieStore.get(SEEN_FROM_COOKIE)?.value,
  });

  const myFilmIds = myItems.map((i) => i.filmId);
  // Including you: feeds the "Everyone wants these" threshold. No club, no
  // overlap: every count is 0, so that shelf never appears.
  const overlap = seenFrom ? await overlapByFilm(db, seenFrom.id, myFilmIds) : new Map<string, number>();
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
  const [others, watchedRows] = seenFrom
    ? await Promise.all([
        overlapByFilm(db, seenFrom.id, resultIds, { excludeUserId: user.id }),
        db
          .select({ filmId: nights.winningFilmId })
          .from(nights)
          .where(and(eq(nights.clubId, seenFrom.id), eq(nights.state, "watched"))),
      ])
    : [new Map<string, number>(), []];
  const watched = new Set(watchedRows.map((r) => r.filmId));
  const onMyList = new Set(myFilmIds);
  // Films already on someone's list in the Seen from club float to the top
  // (watchlist-spec.md §1.1); a stable sort keeps relevance within each group.
  const rows = [...results].sort((a, b) => Number((others.get(b.id) ?? 0) > 0) - Number((others.get(a.id) ?? 0) > 0));
  // A ?seen= preset lasts the visit, so a search carries it along.
  const presetSeen = seenParam && seenFrom?.id === seenParam ? seenParam : undefined;

  return (
    <GlobalShell current="watchlist">
      <h1 className="h-display mt14" style={{ fontSize: 24 }}>
        Your watchlist
      </h1>
      <p className="small muted" style={{ margin: "4px 0 0" }}>
        {PRIVACY}
      </p>

      {showChips && seenFrom && (
        <form action={setSeenFrom} className="row gap8 mt14 seen-from" style={{ flexWrap: "wrap", alignItems: "center" }}>
          <span className="small muted">Seen from:</span>
          {myClubs.map((c, i) => (
            <span key={c.id} className="row gap8" style={{ alignItems: "center" }}>
              {i > 0 && (
                <span className="dim" aria-hidden="true">
                  ·
                </span>
              )}
              <button
                type="submit"
                name="clubId"
                value={c.id}
                className="chip"
                aria-pressed={c.id === seenFrom.id}
              >
                {c.name}
              </button>
            </span>
          ))}
        </form>
      )}

      <Form action="/watchlist" className="search mt14">
        {presetSeen && <input type="hidden" name="seen" value={presetSeen} />}
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
              const n = others.get(f.id) ?? 0;
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
                    {seenFrom && n > 0 && (
                      <p className="tiny mt-1 overlap-badge">
                        {n} other{n === 1 ? "" : "s"} in {seenFrom.name} want{n === 1 ? "s" : ""} this
                      </p>
                    )}
                    {seenFrom && watched.has(f.id) && (
                      <p className="tiny dim mt-1 watched-badge">{seenFrom.name} watched this</p>
                    )}
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
              <button type="submit" className="tiny underline">
                Remove
              </button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
