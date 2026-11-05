// Pure shaping for a club's History (rebuild step 5f). No DB calls: the
// history-read module (app/clubs/[clubId]/historyRead.ts) loads rows and
// hands them here.
//
// CLAUDE.md "History is shared and symmetric": every member sees the same
// record of what the club did together. Never who voted for what after
// lock, never any per-member total or percentage across nights.
import { areTakesRevealed } from "./ratingReveal";
import type { NightState } from "./rotation";

const TERMINAL: readonly NightState[] = ["watched", "cancelled", "unconfirmed"];

// History is finished nights only, newest first. Cancelled and
// unconfirmed nights are part of it, never filtered out.
export function terminalNightsNewestFirst<N extends { state: NightState; scheduledAt: Date }>(nights: N[]): N[] {
  return nights
    .filter((n) => TERMINAL.includes(n.state))
    .sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime());
}

export interface TallyRow {
  nominationId: string;
  filmId: string;
  count: number;
  winner: boolean;
}

// The final tally: a count per nominee, winner first and marked, then by
// count. Built from the nomination ids of the night's votes and nothing
// else — no voter can be recovered from it.
export function tallyNight(
  nominations: { id: string; filmId: string }[],
  voteNominationIds: string[],
  winningFilmId: string | null,
): TallyRow[] {
  const rows = nominations.map((n, index) => ({
    index,
    row: {
      nominationId: n.id,
      filmId: n.filmId,
      count: voteNominationIds.filter((id) => id === n.id).length,
      winner: winningFilmId !== null && n.filmId === winningFilmId,
    },
  }));
  rows.sort(
    (a, b) =>
      Number(b.row.winner) - Number(a.row.winner) || b.row.count - a.row.count || a.index - b.index,
  );
  return rows.map((r) => r.row);
}

// Blind reveal (CLAUDE.md): a night's ratings stay hidden, scores and
// takes alike, until everyone who RSVP'd yes has rated.
export function ratingsView<R extends { membershipId: string }>(
  attendingMembershipIds: string[],
  ratings: R[],
): { revealed: true; ratings: R[] } | { revealed: false } {
  const revealed = areTakesRevealed(
    attendingMembershipIds,
    ratings.map((r) => r.membershipId),
  );
  return revealed ? { revealed: true, ratings } : { revealed: false };
}
