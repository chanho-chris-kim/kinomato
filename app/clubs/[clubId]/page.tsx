import { and, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { getDb } from "@/db";
import {
  clubs,
  films,
  memberships,
  nights,
  nominations,
  ratings,
  rsvps,
  votes,
  watchlistItems,
} from "@/db/schema";
import { getNomineesPerTurn } from "@/lib/clubSettings";
import { areTakesRevealed } from "@/lib/ratingReveal";
import { getNextPicker, type RotationMembership, type RotationNight } from "@/lib/rotation";
import {
  castVote,
  clearIdentity,
  confirmNight,
  lockNight,
  openVoting,
  pickIdentity,
  setRsvp,
  submitRating,
} from "./actions";
import { getIdentityMembershipId } from "./identity";
import { NominationSelector } from "./NominationSelector";
import { NON_TERMINAL_STATES } from "./nightState";

export default async function ClubPage({
  params,
}: {
  params: Promise<{ clubId: string }>;
}) {
  const { clubId } = await params;
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  // react-hooks/purity is a React Compiler rule aimed at client
  // components it might memoize; this is a Server Component that reads
  // the database (already impure) once per request and is never
  // recompiled client-side, so "current time" here is no different in
  // kind from any other request-time read above.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

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

  // No auth in v0 — a name picker is the whole identity flow.
  if (!currentMembership) {
    return (
      <main className="p-4">
        <h1 className="text-xl font-bold">{club.name}</h1>
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

  const clubNights = await db.select().from(nights).where(eq(nights.clubId, clubId));

  const rotationMemberships: RotationMembership[] = clubMemberships.map((m) => ({
    id: m.id,
    identityKey: m.identityKey,
    clubId: m.clubId,
    joinedAt: m.joinedAt,
    leftAt: m.leftAt,
    postponedAt: m.postponedAt,
  }));
  const rotationNights: RotationNight[] = clubNights.map((n) => ({
    pickerMembershipId: n.pickerMembershipId,
    state: n.state,
    scheduledAt: n.scheduledAt,
  }));
  const whoseTurnResult = getNextPicker({
    memberships: rotationMemberships,
    nights: rotationNights,
    clubPausedAt: club.pausedAt,
  });
  const whoseTurn = whoseTurnResult
    ? clubMemberships.find((m) => m.id === whoseTurnResult.id)
    : null;

  const openNight = clubNights.find((n) => n.state === "open") ?? null;
  // RSVP stays live through lock — "the RSVP-flip problem" (analysis-
  // v1.md §1.2) has Dana change her answer *after* lock; the ruling is
  // that it doesn't re-run the filter or change the pick, not that the
  // form disappears. Voting and locking are strictly "open"-only below.
  const rsvpableNight =
    clubNights.find((n) => n.state === "open" || n.state === "locked") ?? null;

  let pickerName: string | null = null;
  let nomineeRows: {
    nominationId: string;
    filmTitle: string;
    filmYear: number;
    voteCount: number;
    votedByMe: boolean;
  }[] = [];
  let myRsvpStatus: "yes" | "no" | null = null;

  if (rsvpableNight) {
    const [myRsvp] = await db
      .select()
      .from(rsvps)
      .where(
        and(
          eq(rsvps.nightId, rsvpableNight.id),
          eq(rsvps.membershipId, currentMembership.id),
        ),
      );
    myRsvpStatus = myRsvp?.status ?? null;
  }

  if (openNight) {
    pickerName =
      clubMemberships.find((m) => m.id === openNight.pickerMembershipId)?.displayName ??
      "someone who's left";

    const nightNominations = await db
      .select({
        nominationId: nominations.id,
        filmTitle: films.title,
        filmYear: films.year,
      })
      .from(nominations)
      .innerJoin(films, eq(nominations.filmId, films.id))
      .where(eq(nominations.nightId, openNight.id));

    const nominationIds = nightNominations.map((n) => n.nominationId);
    const nightVotes = nominationIds.length
      ? await db.select().from(votes).where(inArray(votes.nominationId, nominationIds))
      : [];

    nomineeRows = nightNominations.map((n) => ({
      nominationId: n.nominationId,
      filmTitle: n.filmTitle,
      filmYear: n.filmYear,
      voteCount: nightVotes.filter((v) => v.nominationId === n.nominationId).length,
      votedByMe: nightVotes.some(
        (v) => v.nominationId === n.nominationId && v.membershipId === currentMembership.id,
      ),
    }));
  }

  // A night with no nominations yet — analysis-v1.md §1.1 stage 5. Only
  // the picker sees anything selectable; everyone else sees whose turn
  // it is. Once nominations exist, this night moves to "open" and the
  // section above takes over — the two can't both be true for the same
  // night, but a different night could independently be in each state
  // (this club's seed data has exactly that: one open night mid-vote,
  // one draft night waiting on its picker).
  const draftNight = clubNights.find((n) => n.state === "draft") ?? null;
  let draftPickerName: string | null = null;
  let myWatchlistFilms: { id: string; title: string; year: number }[] = [];
  let nomineesPerTurn = 3;

  if (draftNight) {
    draftPickerName =
      clubMemberships.find((m) => m.id === draftNight.pickerMembershipId)?.displayName ??
      "someone who's left";

    if (draftNight.pickerMembershipId === currentMembership.id) {
      nomineesPerTurn = getNomineesPerTurn(club.settings);
      myWatchlistFilms = await db
        .select({ id: films.id, title: films.title, year: films.year })
        .from(watchlistItems)
        .innerJoin(films, eq(watchlistItems.filmId, films.id))
        .where(eq(watchlistItems.membershipId, currentMembership.id));
    }
  }

  // "Did you watch X?" (analysis-v1.md §1.1 stage 10) — a non-terminal
  // night past its scheduled time, with a winner already set. Gated on
  // winningFilmId because nothing locks a night yet (see nightState.ts);
  // in practice this only ever matches a "locked" night.
  const confirmableNight =
    clubNights.find(
      (n) =>
        NON_TERMINAL_STATES.includes(n.state as (typeof NON_TERMINAL_STATES)[number]) &&
        n.winningFilmId !== null &&
        n.scheduledAt.getTime() < now,
    ) ?? null;

  let confirmableFilmTitle: string | null = null;
  if (confirmableNight?.winningFilmId) {
    const [film] = await db
      .select({ title: films.title })
      .from(films)
      .where(eq(films.id, confirmableNight.winningFilmId));
    confirmableFilmTitle = film?.title ?? null;
  }

  // Rating (analysis-v1.md §1.1 stage 10, "then ratings and one-line
  // takes") — the club's most recently watched night, so this only ever
  // surfaces the one confirmation just produced, not a backlog of every
  // watched night in the club's history. "Attending" (both for who gets
  // the form and for the blind-reveal denominator) means an explicit
  // yes-RSVP, matching the constraint scoping asymmetry elsewhere.
  const mostRecentWatchedNight =
    clubNights
      .filter((n) => n.state === "watched")
      .sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime())[0] ?? null;

  let ratingSection: {
    nightId: string;
    filmTitle: string;
    myRsvpYes: boolean;
    myRating: { scoreQuality: string; scoreFun: string } | null;
    attendingCount: number;
    ratedAttendingCount: number;
    revealed: boolean;
    revealedRatings: {
      displayName: string;
      scoreQuality: string;
      scoreFun: string;
      hotTake: string | null;
    }[];
  } | null = null;

  if (mostRecentWatchedNight?.winningFilmId) {
    const [film] = await db
      .select({ title: films.title })
      .from(films)
      .where(eq(films.id, mostRecentWatchedNight.winningFilmId));

    const nightRsvps = await db
      .select()
      .from(rsvps)
      .where(eq(rsvps.nightId, mostRecentWatchedNight.id));
    const attendingMembershipIds = nightRsvps
      .filter((r) => r.status === "yes")
      .map((r) => r.membershipId);

    const nightRatings = await db
      .select()
      .from(ratings)
      .where(eq(ratings.nightId, mostRecentWatchedNight.id));
    const ratedMembershipIds = nightRatings.map((r) => r.membershipId);
    const revealed = areTakesRevealed(attendingMembershipIds, ratedMembershipIds);

    ratingSection = {
      nightId: mostRecentWatchedNight.id,
      filmTitle: film?.title ?? "this film",
      myRsvpYes: attendingMembershipIds.includes(currentMembership.id),
      myRating:
        nightRatings.find((r) => r.membershipId === currentMembership.id) ?? null,
      attendingCount: attendingMembershipIds.length,
      ratedAttendingCount: attendingMembershipIds.filter((id) =>
        ratedMembershipIds.includes(id),
      ).length,
      revealed,
      revealedRatings: revealed
        ? nightRatings.map((r) => ({
            displayName:
              clubMemberships.find((m) => m.id === r.membershipId)?.displayName ??
              "someone who's left",
            scoreQuality: r.scoreQuality,
            scoreFun: r.scoreFun,
            hotTake: r.hotTake,
          }))
        : [],
    };
  }

  return (
    <main className="p-4">
      <h1 className="text-xl font-bold">{club.name}</h1>
      <div className="mt-1">
        You are: {currentMembership.displayName}{" "}
        <form
          action={clearIdentity.bind(null, clubId)}
          className="inline"
        >
          <button type="submit" className="underline">
            (switch)
          </button>
        </form>
      </div>

      <p className="mt-1">
        <Link href={`/clubs/${clubId}/list`} className="underline">
          My watchlist
        </Link>
      </p>

      <h2 className="mt-4 font-semibold">Whose turn</h2>
      <p>{whoseTurn ? whoseTurn.displayName : "Nobody active in this club."}</p>

      {draftNight &&
        (draftNight.pickerMembershipId === currentMembership.id ? (
          <>
            <h2 className="mt-4 font-semibold">Your turn to nominate</h2>
            {myWatchlistFilms.length === 0 ? (
              <p className="mt-1">
                Your watchlist is empty.{" "}
                <Link href={`/clubs/${clubId}/list`} className="underline">
                  Add films to it
                </Link>{" "}
                before you can nominate.
              </p>
            ) : (
              <form action={openVoting.bind(null, clubId, draftNight.id)}>
                <NominationSelector films={myWatchlistFilms} cap={nomineesPerTurn} />
              </form>
            )}
          </>
        ) : (
          <p className="mt-4">Waiting on {draftPickerName} to nominate.</p>
        ))}

      {!openNight && !draftNight && !confirmableNight && !ratingSection && (
        <p className="mt-4">No open vote right now.</p>
      )}

      {rsvpableNight && (
        <>
          {openNight && (
            <h2 className="mt-4 font-semibold">
              This week&apos;s pick, nominated by {pickerName}
            </h2>
          )}

          <h3 className="mt-4 font-semibold">RSVP</h3>
          <p className="mt-1">
            Current answer: {myRsvpStatus ?? "no answer yet"}
          </p>
          <div className="mt-1 flex gap-2">
            <form action={setRsvp.bind(null, clubId, rsvpableNight.id, "yes")}>
              <button
                type="submit"
                className={`border px-3 py-1 ${myRsvpStatus === "yes" ? "bg-gray-200" : ""}`}
              >
                Going
              </button>
            </form>
            <form action={setRsvp.bind(null, clubId, rsvpableNight.id, "no")}>
              <button
                type="submit"
                className={`border px-3 py-1 ${myRsvpStatus === "no" ? "bg-gray-200" : ""}`}
              >
                Not going
              </button>
            </form>
          </div>
        </>
      )}

      {openNight && (
        <>
          <h3 className="mt-4 font-semibold">Nominees</h3>
          <ul className="mt-1 space-y-2">
            {nomineeRows.map((n) => (
              <li key={n.nominationId} className="border p-2">
                <div>
                  {n.filmTitle} ({n.filmYear}) — {n.voteCount}{" "}
                  {n.voteCount === 1 ? "vote" : "votes"}
                  {n.votedByMe && " — your vote"}
                </div>
                <form action={castVote.bind(null, clubId, n.nominationId)}>
                  <button type="submit" className="mt-1 border px-3 py-1">
                    {n.votedByMe ? "Voted" : "Vote"}
                  </button>
                </form>
              </li>
            ))}
          </ul>

          <form action={lockNight.bind(null, clubId, openNight.id)} className="mt-4">
            <button type="submit" className="border px-3 py-1">
              Lock it in
            </button>
          </form>
        </>
      )}

      {confirmableNight && (
        <>
          <h2 className="mt-4 font-semibold">
            Did you watch {confirmableFilmTitle ?? "it"}?
          </h2>
          <div className="mt-1 flex gap-2">
            <form action={confirmNight.bind(null, clubId, confirmableNight.id, "watched")}>
              <button type="submit" className="border px-3 py-1">
                Yes
              </button>
            </form>
            <form
              action={confirmNight.bind(null, clubId, confirmableNight.id, "cancelled")}
            >
              <button type="submit" className="border px-3 py-1">
                We didn&apos;t meet
              </button>
            </form>
          </div>
        </>
      )}

      {ratingSection && (
        <>
          <h2 className="mt-4 font-semibold">Rate {ratingSection.filmTitle}</h2>

          {ratingSection.myRsvpYes && !ratingSection.myRating && (
            <form
              action={submitRating.bind(null, clubId, ratingSection.nightId)}
              className="mt-1 space-y-2"
            >
              <div>
                <label>
                  Quality{" "}
                  <input
                    type="range"
                    name="scoreQuality"
                    min="0"
                    max="10"
                    step="0.5"
                    defaultValue="5"
                  />
                </label>
              </div>
              <div>
                <label>
                  Fun{" "}
                  <input
                    type="range"
                    name="scoreFun"
                    min="0"
                    max="10"
                    step="0.5"
                    defaultValue="5"
                  />
                </label>
              </div>
              <div>
                <label>
                  One-line take (optional){" "}
                  <input type="text" name="hotTake" maxLength={140} className="border" />
                </label>
              </div>
              <button type="submit" className="border px-3 py-1">
                Submit rating
              </button>
            </form>
          )}

          {!ratingSection.revealed && ratingSection.attendingCount > 0 && (
            <p className="mt-1">
              {ratingSection.ratedAttendingCount}/{ratingSection.attendingCount} ratings
              in — hidden until everyone who&apos;s coming has rated.
            </p>
          )}

          {ratingSection.revealed && (
            <ul className="mt-1 space-y-2">
              {ratingSection.revealedRatings.map((r, i) => (
                <li key={i} className="border p-2">
                  <div>
                    {r.displayName} — quality {r.scoreQuality}, fun {r.scoreFun}
                  </div>
                  {r.hotTake && <div>&quot;{r.hotTake}&quot;</div>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
