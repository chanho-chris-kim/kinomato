import { PREFERENCE_WARNING } from "@/lib/preferenceWarnings";
import { formatRuntime } from "@/lib/format";
import { castVote, lockNight } from "../actions";
import { PosterBox, StageCard } from "./StageCard";

export interface NomineeCard {
  nominationId: string;
  filmTitle: string;
  filmYear: number;
  posterPath: string | null;
  director: string | null;
  runtime: number | null;
  // Null when the club doesn't show counts while voting is open.
  voteCount: number | null;
  votedByMe: boolean;
  someoneWouldRatherNot: boolean;
}

// Vote (an open night). Each nominee is a poster card and the whole card is
// the vote button (a form per card, aria-pressed). castVote replaces your
// vote with the new one and does nothing once voting has closed, so you can
// change your vote until then; tapping your own vote again keeps it.
export function VoteStage({
  main,
  clubId,
  nightId,
  pickerName,
  closesLabel,
  nominees,
  canClose,
}: {
  main: boolean;
  clubId: string;
  nightId: string;
  pickerName: string;
  closesLabel: string | null;
  nominees: NomineeCard[];
  // Owner or admin: "Close voting and set the pick" (CLAUDE.md lock ruling).
  canClose: boolean;
}) {
  const voted = nominees.some((n) => n.votedByMe);
  return (
    <StageCard
      main={main}
      id="vote"
      eyebrow={voted ? "Voting" : "Your move"}
      title={`This week's pick, nominated by ${pickerName}`}
    >
      <p className="small muted mt-1">
        {pickerName} picked these. Tap a poster to vote.
        {closesLabel && (
          <>
            {" "}
            <span className="voting-closes">Voting closes {closesLabel}</span>.
          </>
        )}
      </p>
      <ul className="vote-grid mt14">
        {nominees.map((n) => (
          <li key={n.nominationId} className="nominee">
            <form action={castVote.bind(null, clubId, n.nominationId)}>
              <button type="submit" className="vote-card" aria-pressed={n.votedByMe}>
                <PosterBox posterPath={n.posterPath} title={n.filmTitle} size={185} className="vote-poster" />
                <span className="vote-text">
                  <span className="small">
                    {n.filmTitle} <span className="dim">({n.filmYear})</span>
                  </span>
                  {(n.director || n.runtime) && (
                    <span className="tiny muted">
                      {[n.director, n.runtime ? formatRuntime(n.runtime) : null].filter(Boolean).join(" · ")}
                    </span>
                  )}
                  {n.voteCount !== null && (
                    <span className="tiny vote-count">
                      {n.voteCount} {n.voteCount === 1 ? "vote" : "votes"}
                    </span>
                  )}
                  {n.votedByMe ? (
                    <span className="pill vote-badge">
                      Your vote <span aria-hidden="true">✓</span>
                    </span>
                  ) : (
                    <span className="vote-cta small">Vote</span>
                  )}
                </span>
              </button>
            </form>
            {n.someoneWouldRatherNot && <p className="tiny dim pref-note">{PREFERENCE_WARNING}</p>}
          </li>
        ))}
      </ul>
      <p className="tiny dim mt14">You can change your vote until voting closes.</p>
      <p className="tiny dim flush">If nobody votes, {pickerName}&apos;s first choice wins.</p>
      {canClose && (
        <div className="mt14">
          <form action={lockNight.bind(null, clubId, nightId)}>
            <button type="submit" className="btn">
              Close voting and set the pick
            </button>
          </form>
          <p className="tiny dim mt-1">The pick can&apos;t be changed after this.</p>
        </div>
      )}
    </StageCard>
  );
}
