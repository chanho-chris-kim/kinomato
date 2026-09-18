// Which nomination wins at lock. Pure — no DB calls.
//
// Tie-break chain: most votes, then fewest soft-preference conflicts
// among attending members (lib/constraints.ts's
// countSoftPreferenceConflicts — cheap to wire here since the caller
// already has films/constraints/rsvps on hand from tallying), then
// nomination id ASC as a last-resort deterministic fallback, same
// shape as lib/rotation.ts's trailing id ASC — without it a full tie
// is nondeterministic.
//
// analysis-v2.md §2 documents a further tiebreak key after
// soft-preference count — club-overlap descending — that this module
// doesn't implement: it needs a per-film watchlist-overlap count that
// isn't cheap to assemble from data this function already has (a
// separate query across every member's watchlist, not a filter over
// data already in hand). Left as a gap, not guessed at.
//
// This module doesn't know or care who "the picker" is — every
// nomination on a night already belongs to the same picker (the
// picker never loses their turn, only which film), so there's no
// scenario here where breaking a tie means choosing between two
// different members' films.

import {
  countSoftPreferenceConflicts,
  type Constraint,
  type ConstraintFilm,
  type Rsvp,
} from "./constraints";

export interface TallyNomination {
  id: string;
  filmId: string;
}

export interface TallyVote {
  nominationId: string;
}

export interface PickWinnerInput {
  nominations: TallyNomination[];
  votes: TallyVote[];
  // Every nominated film, keyed by id === filmId.
  films: ConstraintFilm[];
  constraints: Constraint[];
  rsvps: Rsvp[];
}

export function pickWinningNomination(input: PickWinnerInput): string | null {
  if (input.nominations.length === 0) return null;

  const voteCounts = new Map<string, number>();
  for (const nomination of input.nominations) voteCounts.set(nomination.id, 0);
  for (const vote of input.votes) {
    voteCounts.set(vote.nominationId, (voteCounts.get(vote.nominationId) ?? 0) + 1);
  }

  const maxVotes = Math.max(...input.nominations.map((n) => voteCounts.get(n.id) ?? 0));
  let candidates = input.nominations.filter((n) => voteCounts.get(n.id) === maxVotes);
  if (candidates.length === 1) return candidates[0].id;

  const candidateFilms = input.films.filter((f) =>
    candidates.some((n) => n.filmId === f.id),
  );
  const conflicts = countSoftPreferenceConflicts(
    candidateFilms,
    input.constraints,
    input.rsvps,
  );
  const conflictByFilmId = new Map(conflicts.map((c) => [c.film.id, c.conflictCount]));
  const minConflicts = Math.min(
    ...candidates.map((n) => conflictByFilmId.get(n.filmId) ?? 0),
  );
  candidates = candidates.filter(
    (n) => (conflictByFilmId.get(n.filmId) ?? 0) === minConflicts,
  );
  if (candidates.length === 1) return candidates[0].id;

  return [...candidates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0].id;
}
