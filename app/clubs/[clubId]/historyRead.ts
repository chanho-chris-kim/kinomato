import { and, eq, inArray } from "drizzle-orm";
import type { getDb } from "@/db";
import {
  clubs,
  films,
  nights,
  nominations,
  ratings,
  ratingTags,
  rsvps,
  tags,
  vetoes,
  votes,
} from "@/db/schema";
import { ratingsView, tallyNight, terminalNightsNewestFirst } from "@/lib/history";
import type { NightState } from "@/lib/rotation";
import { loadClubMemberships, nameOf } from "./members";

// The history-read module (CLAUDE.md "Attribution is retained, never
// deleted — access is the control"; rebuild step 5f). The ONLY code that
// reads the votes and vetoes tables — lib/attributionAccess.test.ts fails
// if anything else does. votes.membership_id and vetoes.membership_id are
// kept forever as the audit trail; what keeps them off every screen is
// that nothing returned from here carries one. Server-side only: it takes
// the request's database handle and is never imported by a client
// component.
//
// What each export may say about votes:
// - liveVotes: an open night's counts, and which nominee *you* voted for.
//   Live counts are visible during voting; your own vote is yours.
// - viewerVotedOnOpenNights: whether *you* have voted, for the club cards.
// - votesForLock: the nomination ids of an open night's votes, for the
//   tally that picks the winner at lock.
// - clubHistory: finished nights' final counts and a veto count. Never who
//   voted for what, never who vetoed.

type Db = ReturnType<typeof getDb>;

// The night's own state, checked here rather than trusted from a caller:
// live counts exist only while voting is open.
async function isOpen(db: Db, nightId: string): Promise<boolean> {
  const [night] = await db.select({ state: nights.state }).from(nights).where(eq(nights.id, nightId));
  return night?.state === "open";
}

// Tonight's live tally: a count per nominee, and the viewer's own pick.
// Null unless the night is open (pre-lock only).
export async function liveVotes(
  db: Db,
  openNightId: string,
  viewerMembershipId: string,
): Promise<{ counts: Record<string, number>; viewerVotedFor: string | null } | null> {
  if (!(await isOpen(db, openNightId))) return null;
  const rows = await db
    .select({ nominationId: votes.nominationId, membershipId: votes.membershipId })
    .from(votes)
    .innerJoin(nominations, eq(votes.nominationId, nominations.id))
    .where(eq(nominations.nightId, openNightId));
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.nominationId] = (counts[r.nominationId] ?? 0) + 1;
  return {
    counts,
    viewerVotedFor: rows.find((r) => r.membershipId === viewerMembershipId)?.nominationId ?? null,
  };
}

// For the club cards on `/`: which of these open nights the viewer (any of
// their memberships) has voted on. Night ids only. Batched across clubs.
export async function viewerVotedOnOpenNights(
  db: Db,
  openNightIds: string[],
  viewerMembershipIds: string[],
): Promise<Set<string>> {
  if (openNightIds.length === 0 || viewerMembershipIds.length === 0) return new Set();
  const rows = await db
    .select({ nightId: nominations.nightId })
    .from(votes)
    .innerJoin(nominations, eq(votes.nominationId, nominations.id))
    .innerJoin(nights, eq(nominations.nightId, nights.id))
    .where(
      and(
        inArray(nominations.nightId, openNightIds),
        inArray(votes.membershipId, viewerMembershipIds),
        eq(nights.state, "open"),
      ),
    );
  return new Set(rows.map((r) => r.nightId));
}

// For lockNightCore: the nomination id of every vote on an open night, so
// lib/lockTally.ts can count them. Empty unless the night is open.
export async function votesForLock(db: Db, nightId: string): Promise<{ nominationId: string }[]> {
  if (!(await isOpen(db, nightId))) return [];
  return db
    .select({ nominationId: votes.nominationId })
    .from(votes)
    .innerJoin(nominations, eq(votes.nominationId, nominations.id))
    .where(eq(nominations.nightId, nightId));
}

export interface HistoryRating {
  raterName: string;
  scoreQuality: string;
  scoreFun: string;
  hotTake: string | null;
  tags: { name: string; displayName: string }[];
}

export interface HistoryNight {
  nightId: string;
  scheduledAt: Date;
  state: Extract<NightState, "watched" | "cancelled" | "unconfirmed">;
  film: { title: string; year: number } | null;
  pickerName: string;
  // Final counts per nominee, winner first and marked. No voters.
  tally: { title: string; year: number; count: number; winner: boolean }[];
  // How many vetoes, never by whom.
  vetoCount: number;
  // Explicit yes-RSVPs, by name: who came. Watched nights only.
  attendees: string[];
  // Watched nights only: revealed ratings, or hidden until everyone who
  // came has rated (blind reveal).
  ratings: { revealed: true; ratings: HistoryRating[] } | { revealed: false } | null;
}

// A club's finished nights (watched, cancelled, unconfirmed), newest first.
// No time limit: analysis-v1's free-tier history cap doesn't apply.
export async function clubHistory(db: Db, clubId: string): Promise<{ timezone: string; nights: HistoryNight[] }> {
  const [club] = await db.select({ timezone: clubs.timezone }).from(clubs).where(eq(clubs.id, clubId));
  const allNights = await db.select().from(nights).where(eq(nights.clubId, clubId));
  const finished = terminalNightsNewestFirst(allNights);
  if (finished.length === 0) return { timezone: club?.timezone ?? "UTC", nights: [] };

  const nightIds = finished.map((n) => n.id);
  const [members, nightNominations, nightRsvps, nightRatings, vetoRows] = await Promise.all([
    loadClubMemberships(db, clubId),
    db
      .select({ id: nominations.id, nightId: nominations.nightId, filmId: nominations.filmId })
      .from(nominations)
      .where(inArray(nominations.nightId, nightIds)),
    db
      .select({ nightId: rsvps.nightId, membershipId: rsvps.membershipId })
      .from(rsvps)
      .where(and(inArray(rsvps.nightId, nightIds), eq(rsvps.status, "yes"))),
    db.select().from(ratings).where(inArray(ratings.nightId, nightIds)),
    // Night ids only: a count, never the vetoer.
    db.select({ nightId: vetoes.nightId }).from(vetoes).where(inArray(vetoes.nightId, nightIds)),
  ]);

  const nominationIds = nightNominations.map((n) => n.id);
  const ratingIds = nightRatings.map((r) => r.id);
  const filmIds = [
    ...new Set([
      ...nightNominations.map((n) => n.filmId),
      ...finished.map((n) => n.winningFilmId).filter((id): id is string => id !== null),
    ]),
  ];
  const [voteRows, filmRows, tagRows] = await Promise.all([
    // Nomination ids only: counts, never voters.
    nominationIds.length
      ? db.select({ nominationId: votes.nominationId }).from(votes).where(inArray(votes.nominationId, nominationIds))
      : [],
    filmIds.length
      ? db.select({ id: films.id, title: films.title, year: films.year }).from(films).where(inArray(films.id, filmIds))
      : [],
    ratingIds.length
      ? db
          .select({ ratingId: ratingTags.ratingId, name: tags.name, displayName: tags.displayName })
          .from(ratingTags)
          .innerJoin(tags, eq(ratingTags.tagId, tags.id))
          .where(inArray(ratingTags.ratingId, ratingIds))
      : [],
  ]);

  const film = (id: string | null) => {
    const f = id ? filmRows.find((r) => r.id === id) : undefined;
    return f ? { title: f.title, year: f.year } : null;
  };
  const name = (membershipId: string) => nameOf(members.find((m) => m.id === membershipId));
  const voteNominationIds = voteRows.map((v) => v.nominationId);

  return {
    timezone: club?.timezone ?? "UTC",
    nights: finished.map((night) => {
      const state = night.state as HistoryNight["state"];
      const attendingIds = nightRsvps.filter((r) => r.nightId === night.id).map((r) => r.membershipId);
      const view = ratingsView(
        attendingIds,
        nightRatings.filter((r) => r.nightId === night.id),
      );
      return {
        nightId: night.id,
        scheduledAt: night.scheduledAt,
        state,
        film: film(night.winningFilmId),
        pickerName: name(night.pickerMembershipId),
        tally: tallyNight(
          nightNominations.filter((n) => n.nightId === night.id),
          voteNominationIds,
          night.winningFilmId,
        ).map((row) => ({ ...film(row.filmId)!, count: row.count, winner: row.winner })),
        vetoCount: vetoRows.filter((v) => v.nightId === night.id).length,
        attendees: state === "watched" ? attendingIds.map(name) : [],
        ratings:
          state !== "watched"
            ? null
            : view.revealed
              ? {
                  revealed: true,
                  ratings: view.ratings.map((r) => ({
                    raterName: name(r.membershipId),
                    scoreQuality: r.scoreQuality,
                    scoreFun: r.scoreFun,
                    hotTake: r.hotTake,
                    tags: tagRows
                      .filter((t) => t.ratingId === r.id)
                      .map((t) => ({ name: t.name, displayName: t.displayName })),
                  })),
                }
              : { revealed: false },
      };
    }),
  };
}
