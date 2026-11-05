import { and, eq, getTableColumns, inArray, isNull } from "drizzle-orm";
import type { getDb } from "@/db";
import { clubs, films, memberships, nights, nominations, ratings, rsvps, users, votes } from "@/db/schema";
import { getConfirmAt } from "@/lib/clubSettings";
import {
  findInFlightNight,
  findLatestWatchedNight,
  getClubStatus,
  getNextNight,
  isActionStatus,
  nextNightText,
  sortClubCards,
  statusText,
} from "@/lib/clubStatus";

export interface ClubCard {
  clubId: string;
  name: string;
  nextNight: string;
  nextAt: Date | null;
  status: string;
  action: boolean;
}

// Ruling A cards for the signed-in `/` (docs/onboarding-spec.md §5.7.1),
// one per active membership. State comes from lib/clubStatus.ts, the same
// functions the club page uses. A fixed number of queries however many
// clubs: three rounds, every one batched across all of them.
//
// Read-only on purpose: `/` never creates a night. A club with nothing in
// flight gets its next night computed for display only; the club page is
// the one place a draft night is inserted.
//
// What's deliberately never read here: member counts, seats, vote counts,
// attendance, anyone's RSVP but the viewer's own on a watched night (only
// to know whether they can rate). The one vote read is the viewer's own
// vote on an open night.
export async function loadClubCards(
  db: ReturnType<typeof getDb>,
  userId: string,
  now: Date,
): Promise<ClubCard[]> {
  const mine = await db
    .select({ membershipId: memberships.id, club: getTableColumns(clubs) })
    .from(memberships)
    .innerJoin(clubs, eq(memberships.clubId, clubs.id))
    .where(and(eq(memberships.userId, userId), isNull(memberships.leftAt)));
  if (mine.length === 0) return [];

  const clubIds = mine.map((m) => m.club.id);
  const myMembershipIds = mine.map((m) => m.membershipId);
  const [clubMemberships, clubNights] = await Promise.all([
    // Every membership, left ones too: rotation carry-forward needs them.
    db
      .select({ ...getTableColumns(memberships), name: users.displayName })
      .from(memberships)
      .leftJoin(users, eq(memberships.userId, users.id))
      .where(inArray(memberships.clubId, clubIds)),
    db.select().from(nights).where(inArray(nights.clubId, clubIds)),
  ]);

  const nightsOf = (clubId: string) => clubNights.filter((n) => n.clubId === clubId);
  const inFlight = clubIds.map((id) => findInFlightNight(nightsOf(id))).filter((n) => n !== null);
  const latestWatched = clubIds
    .map((id) => findLatestWatchedNight(nightsOf(id)))
    .filter((n) => n !== null);
  const openNightIds = inFlight.filter((n) => n.state === "open").map((n) => n.id);
  const watchedIds = latestWatched.map((n) => n.id);
  const filmIds = [...inFlight, ...latestWatched]
    .map((n) => n.winningFilmId)
    .filter((id) => id !== null);

  const [myVotes, myRsvps, myRatings, filmRows] = await Promise.all([
    openNightIds.length
      ? db
          .select({ nightId: nominations.nightId })
          .from(votes)
          .innerJoin(nominations, eq(votes.nominationId, nominations.id))
          .where(and(inArray(nominations.nightId, openNightIds), inArray(votes.membershipId, myMembershipIds)))
      : [],
    watchedIds.length
      ? db
          .select({ nightId: rsvps.nightId, status: rsvps.status })
          .from(rsvps)
          .where(and(inArray(rsvps.nightId, watchedIds), inArray(rsvps.membershipId, myMembershipIds)))
      : [],
    watchedIds.length
      ? db
          .select({ nightId: ratings.nightId })
          .from(ratings)
          .where(and(inArray(ratings.nightId, watchedIds), inArray(ratings.membershipId, myMembershipIds)))
      : [],
    filmIds.length
      ? db.select({ id: films.id, title: films.title }).from(films).where(inArray(films.id, filmIds))
      : [],
  ]);

  const cards = mine.map(({ membershipId, club }) => {
    const members = clubMemberships.filter((m) => m.clubId === club.id);
    const clubNightRows = nightsOf(club.id);
    const open = clubNightRows.find((n) => openNightIds.includes(n.id));
    const watched = latestWatched.find((n) => n.clubId === club.id);
    const status = getClubStatus({
      viewerMembershipId: membershipId,
      club,
      memberships: members,
      nights: clubNightRows,
      confirmAt: getConfirmAt(club.settings),
      now,
      viewerVotedOnOpenNight: open ? myVotes.some((v) => v.nightId === open.id) : false,
      viewerOnLatestWatched: watched
        ? {
            rsvpYes: myRsvps.some((r) => r.nightId === watched.id && r.status === "yes"),
            rated: myRatings.some((r) => r.nightId === watched.id),
          }
        : null,
    });
    const next = getNextNight({ club, nights: clubNightRows, now });
    return {
      clubId: club.id,
      name: club.name,
      nextNight: nextNightText(next, club.timezone),
      nextAt: next.kind === "at" ? next.at : null,
      status: statusText(status, {
        viewerMembershipId: membershipId,
        nameOf: (id) => members.find((m) => m.id === id)?.name ?? "Unnamed member",
        filmTitle: (id) => filmRows.find((f) => f.id === id)?.title ?? "this film",
      }),
      action: isActionStatus(status),
    };
  });
  return sortClubCards(cards);
}
