import Form from "next/form";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { clubs } from "@/db/schema";
import { requireClubMember } from "@/app/auth";
import { GlobalShell } from "@/app/shell";
import { searchFilms } from "@/app/filmCache";
import { addToWatchlist } from "@/app/watchlist/actions";
import { ownFilmIds, wantedInClub } from "@/app/watchlistRead";
import { shownName } from "@/lib/displayName";
import { Poster } from "../Poster";

// Welcome to the club (u3, §5.13): where an invited new account lands after
// the name step, with no step bar. Add at least three films, because a
// picker chooses from their own list. "Wanted in {club}" is what others in
// the club want that fits everyone (app/watchlistRead.ts), counts only,
// never names. Behind the member gate; a returning member who opens it
// sees their own list's state, and nothing here changes anything but it.
const GOAL = 3;

export default async function ClubWelcomePage({
  params,
  searchParams,
}: {
  params: Promise<{ clubId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { clubId } = await params;
  const { q } = await searchParams;
  const query = q?.trim() ?? "";
  const { user } = await requireClubMember(clubId, `/clubs/${clubId}/welcome`);
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const [[club], mine, wanted, results] = await Promise.all([
    db.select({ id: clubs.id, name: clubs.name }).from(clubs).where(eq(clubs.id, clubId)),
    ownFilmIds(db, user.id),
    wantedInClub(db, clubId, user.id),
    query ? searchFilms(db, query) : Promise.resolve([]),
  ]);
  const added = mine.size;
  const done = added >= GOAL;

  return (
    <GlobalShell current="clubs">
      <p className="eyebrow mt14">Welcome to {club.name}</p>
      <h1 className="h-display stage-title">You&apos;re in, {shownName(user.displayName)}</h1>
      <p className="muted mt-1">
        Add at least {GOAL} films you&apos;d like to watch. When it&apos;s your turn to pick, you&apos;ll choose from
        these.
      </p>

      <div className="mt14 film-goal">
        <ol className="goal-segments plain-list" aria-hidden="true">
          {Array.from({ length: GOAL }, (_, i) => (
            <li key={i} className={i < added ? "filled" : ""} />
          ))}
        </ol>
        <p className="small mt-1 goal-count" role="status">
          {done ? `${added} added · you're set` : `${added} of ${GOAL} added`}
        </p>
      </div>

      <Form action={`/clubs/${clubId}/welcome`} className="search mt14">
        <input type="text" name="q" defaultValue={query} placeholder="Search films" aria-label="Search films" />
        <button type="submit" className="btn auto">
          Search
        </button>
      </Form>

      {query && (
        <section className="mt20" aria-labelledby="results-heading">
          <h2 id="results-heading" className="sec">
            Results for &quot;{query}&quot;
          </h2>
          {results.length === 0 && <p className="small muted flush">No results.</p>}
          <ul className="stack gap8 plain-list">
            {results.map((f) => (
              <li key={f.tmdbId} className="result">
                <div className="thumb">
                  <Poster posterPath={f.posterPath} title={f.title} size={92} />
                </div>
                <div className="grow">
                  <div className="small">
                    {f.title} <span className="dim">({f.year})</span>
                  </div>
                  {f.directors[0] && <div className="tiny muted mt-1">{f.directors[0]}</div>}
                  <AddButton tmdbId={f.tmdbId} title={f.title} added={mine.has(f.id)} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {wanted.length > 0 && (
        <section className="mt20 wanted-in-club" aria-labelledby="wanted-heading">
          <h2 id="wanted-heading" className="sec">
            Wanted in {club.name}
          </h2>
          <ul className="stack gap8 plain-list">
            {wanted.map((f) => (
              <li key={f.id} className="card row gap8">
                <div className="grow">
                  <span className="small">
                    {f.title} <span className="dim">({f.year})</span>
                  </span>
                  <p className="tiny dim flush">
                    {f.othersWant} in the club {f.othersWant === 1 ? "wants" : "want"} this
                  </p>
                </div>
                <AddButton tmdbId={f.tmdbId} title={f.title} added={f.onMyList} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt20 stack gap8">
        <Link href={`/clubs/${clubId}`} className={`btn block-link ${done ? "primary" : ""}`}>
          Go to {club.name}
        </Link>
        {!done && (
          <p className="small center flush">
            <Link href={`/clubs/${clubId}`} className="underline tap">
              Skip for now
            </Link>
          </p>
        )}
      </div>
    </GlobalShell>
  );
}

// Add, or Added ✓ once it's on your list (the watchlist's own add action).
function AddButton({ tmdbId, title, added }: { tmdbId: number; title: string; added: boolean }) {
  return added ? (
    <span className="pill added-pill" aria-label={`${title} is on your list`}>
      Added <span aria-hidden="true">✓</span>
    </span>
  ) : (
    <form action={addToWatchlist.bind(null, tmdbId)}>
      <button type="submit" className="btn ghost limit-remove" aria-label={`Add ${title} to my list`}>
        Add
      </button>
    </form>
  );
}
