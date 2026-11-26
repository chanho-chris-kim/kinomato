import Link from "next/link";
import type { ReactNode } from "react";

export interface ThisWeekFacts {
  // "Sat 8:00pm", the night in flight's.
  night: string | null;
  // "Voting closes Sat 8:00pm", or "3 coming".
  status: string | null;
  // Who the club is waiting on (lib/rotation.ts getWhoseTurn).
  picking: string | null;
  // Who picks after them (getNextPicker), when a night is in flight.
  nextTurn: string | null;
}

export interface WatchedFilm {
  nightId: string;
  title: string;
  date: string;
}

// The week in a few facts, for the side column (from 1120px) and the
// phone's collapsed "This week at a glance". Real data only (CLAUDE.md:
// the rail never shows the prototype's fake queue or leaderboard).
function Facts({ facts }: { facts: ThisWeekFacts }) {
  const rows: [string, string | null, string?][] = [
    ["Night", facts.night],
    ["", facts.status],
    ["Picking", facts.picking, "whose-turn"],
    ["Next turn", facts.nextTurn],
  ];
  return (
    <dl className="small facts">
      {rows
        .filter(([, value]) => value)
        .map(([term, value, className]) => (
          <div key={term || "status"} className="fact">
            {term && <dt className="muted">{term}</dt>}
            <dd className={className}>{value}</dd>
          </div>
        ))}
    </dl>
  );
}

function RecentlyWatched({ clubId, films }: { clubId: string; films: WatchedFilm[] }) {
  return (
    <>
      <h2 className="sec mt20">Recently watched</h2>
      {films.length === 0 ? (
        <p className="small muted flush">Nothing yet.</p>
      ) : (
        <ul className="stack gap6 plain-list recently-watched">
          {films.map((f) => (
            <li key={f.nightId} className="between small">
              <span>{f.title}</span>
              <span className="tiny dim">{f.date}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="small mt14">
        <Link href={`/clubs/${clubId}/history`} className="underline tap">
          All history →
        </Link>
      </p>
    </>
  );
}

export function ThisWeekRail({
  clubId,
  facts,
  members,
  watched,
}: {
  clubId: string;
  facts: ThisWeekFacts;
  members: ReactNode;
  watched: WatchedFilm[];
}) {
  return (
    <>
      <h2 className="sec">This week</h2>
      <Facts facts={facts} />
      <div className="mt20">{members}</div>
      <RecentlyWatched clubId={clubId} films={watched} />
    </>
  );
}

// Phones: the same facts below the cards, collapsed until opened.
export function ThisWeekGlance({
  clubId,
  facts,
  watched,
}: {
  clubId: string;
  facts: ThisWeekFacts;
  watched: WatchedFilm[];
}) {
  return (
    <details className="card glance mt14">
      <summary>This week at a glance</summary>
      <div className="mt14">
        <Facts facts={facts} />
        <RecentlyWatched clubId={clubId} films={watched} />
      </div>
    </details>
  );
}
