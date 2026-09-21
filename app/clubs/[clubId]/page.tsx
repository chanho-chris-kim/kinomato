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
  ratingTags,
  rsvps,
  tags,
  votes,
  watchlistItems,
} from "@/db/schema";
import { getConfirmAt, getNomineesPerTurn } from "@/lib/clubSettings";
import { isConfirmable } from "@/lib/confirmTiming";
import { areTakesRevealed } from "@/lib/ratingReveal";
import { getNextPicker, type RotationMembership, type RotationNight } from "@/lib/rotation";
import { getNextOccurrence } from "@/lib/schedule";
import {
  addRatingTag,
  castVote,
  clearIdentity,
  confirmNight,
  lockNight,
  openVoting,
  pickIdentity,
  removeRatingTag,
  setRsvp,
  submitRating,
} from "./actions";
import { ClubNav } from "./ClubNav";
import { getIdentityMembershipId } from "./identity";
import { NominationSelector } from "./NominationSelector";
import { RatingSlider } from "./RatingSlider";
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
        <ClubNav clubId={clubId} clubName={club.name} current="club" />
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

  let clubNights = await db.select().from(nights).where(eq(nights.clubId, clubId));

  // Computed once, from the state as of this request, and never
  // recomputed after a lazy-create below — getNextPicker already treats
  // any non-cancelled night (draft included) as "picked" (CLAUDE.md's
  // lock ruling covers the same mechanic), so re-deriving this against
  // clubNights *after* inserting today's draft night would flip "Whose
  // turn" to a different, more-confusing answer than the "Your turn to
  // nominate" section below it on the very same page load. Both read
  // this one result.
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

  // A night's first draft row is created lazily, right here (CLAUDE.md's
  // load-bearing rulings) — whichever page load first finds the club
  // with no non-terminal night and a resolvable next picker creates one.
  // ad_hoc has no computable schedule (lib/schedule.ts returns null for
  // it on purpose) — the ad_hoc-specific empty state below explains that
  // rather than this silently doing nothing.
  const hasNonTerminalNight = clubNights.some((n) =>
    NON_TERMINAL_STATES.includes(n.state as (typeof NON_TERMINAL_STATES)[number]),
  );
  const adHocNeedsManualNight =
    !hasNonTerminalNight && whoseTurnResult !== null && club.cadence === "ad_hoc";

  if (!hasNonTerminalNight && whoseTurnResult && club.cadence !== "ad_hoc") {
    const scheduledAt = getNextOccurrence(
      {
        cadence: club.cadence,
        defaultDay: club.defaultDay,
        defaultTime: club.defaultTime,
        timezone: club.timezone,
      },
      new Date(now),
      club.createdAt,
    );
    if (scheduledAt) {
      try {
        await db.insert(nights).values({
          clubId,
          scheduledAt,
          pickerMembershipId: whoseTurnResult.id,
          state: "draft",
        });
      } catch (error) {
        // "A club has at most one night in flight" (CLAUDE.md) is a
        // partial unique index — a second concurrent lazy-create is a
        // rejected insert (Postgres 23505), not a duplicate row. Losing
        // that race is expected, not a bug: re-read below picks up
        // whichever request won. Anything else genuinely is a failure.
        const isUniqueViolation =
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code?: unknown }).code === "23505";
        if (!isUniqueViolation) throw error;
      }
      clubNights = await db.select().from(nights).where(eq(nights.clubId, clubId));
    }
  }

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
  // night with a winner already set (gated on winningFilmId because
  // nothing locks a night yet, see nightState.ts; in practice this only
  // ever matches a "locked" night), once the club's confirmAt timing
  // (clubs.settings, analysis-v2.md §2 — default "morning after")
  // allows it. Not just "past scheduled_at": that was the old, fixed
  // behavior "same_night" now models exactly; "morning_after" waits
  // longer, "manual_only" doesn't wait for a schedule at all.
  const confirmAt = getConfirmAt(club.settings);
  const confirmableNight =
    clubNights.find(
      (n) =>
        NON_TERMINAL_STATES.includes(n.state as (typeof NON_TERMINAL_STATES)[number]) &&
        n.winningFilmId !== null &&
        isConfirmable(confirmAt, n.scheduledAt, club.timezone, new Date(now)),
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
    myTags: { tagId: string; displayName: string }[];
    clubTagOptions: string[];
    attendingCount: number;
    ratedAttendingCount: number;
    revealed: boolean;
    revealedRatings: {
      displayName: string;
      scoreQuality: string;
      scoreFun: string;
      hotTake: string | null;
      tags: { name: string; displayName: string }[];
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

    const nightRatingIds = nightRatings.map((r) => r.id);
    const nightRatingTags = nightRatingIds.length
      ? await db
          .select({
            ratingId: ratingTags.ratingId,
            tagId: ratingTags.tagId,
            name: tags.name,
            displayName: tags.displayName,
          })
          .from(ratingTags)
          .innerJoin(tags, eq(ratingTags.tagId, tags.id))
          .where(inArray(ratingTags.ratingId, nightRatingIds))
      : [];

    // Autocomplete source for the add-tag form below — "reuse over
    // invention is the whole point" (CLAUDE.md). Club-scoped, not
    // filtered by reveal state: a brand-new tag from an unrevealed
    // rating could theoretically surface here before the reveal, a
    // narrow and accepted leak (weakly signals "someone already rated"),
    // not worth gating a plain <datalist> on reveal state for.
    const clubTags = await db
      .select({ name: tags.name, displayName: tags.displayName })
      .from(tags)
      .where(eq(tags.clubId, clubId));

    const myRatingRow =
      nightRatings.find((r) => r.membershipId === currentMembership.id) ?? null;

    ratingSection = {
      nightId: mostRecentWatchedNight.id,
      filmTitle: film?.title ?? "this film",
      myRsvpYes: attendingMembershipIds.includes(currentMembership.id),
      myRating: myRatingRow,
      myTags: myRatingRow
        ? nightRatingTags
            .filter((t) => t.ratingId === myRatingRow.id)
            .map((t) => ({ tagId: t.tagId, displayName: t.displayName }))
        : [],
      clubTagOptions: clubTags.map((t) => t.displayName),
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
            tags: nightRatingTags
              .filter((t) => t.ratingId === r.id)
              .map((t) => ({ name: t.name, displayName: t.displayName })),
          }))
        : [],
    };
  }

  return (
    <main className="p-4">
      <ClubNav clubId={clubId} clubName={club.name} current="club" />
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
        Invite link:{" "}
        <Link href={`/clubs/${clubId}/join`} className="underline">
          /clubs/{clubId}/join
        </Link>
      </p>

      <h2 className="mt-4 font-semibold">Members</h2>
      <p className="mt-1">{activeMemberships.map((m) => m.displayName).join(", ")}</p>

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

      {!openNight &&
        !draftNight &&
        !confirmableNight &&
        !ratingSection &&
        (adHocNeedsManualNight ? (
          // "ad_hoc" has no computable next occurrence on purpose
          // (lib/schedule.ts) — an ad-hoc club doesn't have a standing
          // day/time to compute from, so lazy-creation can't fire here.
          // Named explicitly so this reads as a real, permanent property
          // of an ad_hoc club rather than a bug — there's no UI yet to
          // schedule one manually either (a real gap, not solved here).
          <>
            <h2 className="mt-4 font-semibold">No night scheduled</h2>
            <p className="mt-1">
              This club is ad hoc — nights aren&apos;t scheduled
              automatically. There&apos;s no way to schedule one manually
              yet either.
            </p>
          </>
        ) : clubNights.length === 0 ? (
          // Reachable when nobody's active in the club yet to become the
          // picker lazy-creation needs — not the common case once a club
          // has its owner, but a real one (e.g. every membership somehow
          // left). The actual first impression for a normal new club is
          // the draft night created above, same request, not this.
          <>
            <h2 className="mt-4 font-semibold">No night scheduled yet</h2>
            <p className="mt-1">
              This club hasn&apos;t had a movie night. Share the invite link
              above with the rest of your group.
            </p>
          </>
        ) : (
          <p className="mt-4">No open vote right now.</p>
        ))}

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

          {(currentMembership.role === "owner" || currentMembership.role === "admin") && (
            <div className="mt-4">
              <form action={lockNight.bind(null, clubId, openNight.id)}>
                <button type="submit" className="border px-3 py-1">
                  Close voting and set the pick
                </button>
              </form>
              <p className="text-sm mt-1">
                The pick can&apos;t be changed after this.
              </p>
            </div>
          )}
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
              <RatingSlider name="scoreQuality" label="Quality" />
              <RatingSlider name="scoreFun" label="Fun" />
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

          {ratingSection.myRating && (
            // Tags live on the rating row, so they can only be added once
            // the rating itself exists — that's why this is a separate
            // section below the initial submit rather than more fields on
            // that form (CLAUDE.md: tags alongside the hot take, editable
            // and removable on a rating you've already submitted).
            <div className="mt-2">
              <h3 className="font-semibold">Your tags</h3>
              {ratingSection.myTags.length > 0 && (
                <ul className="mt-1 flex flex-wrap gap-2">
                  {ratingSection.myTags.map((t) => (
                    <li key={t.tagId} className="border px-2 py-1 text-sm">
                      {t.displayName}{" "}
                      <form
                        action={removeRatingTag.bind(
                          null,
                          clubId,
                          ratingSection.nightId,
                          t.tagId,
                        )}
                        className="inline"
                      >
                        <button type="submit" className="underline">
                          remove
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
              <form
                action={addRatingTag.bind(null, clubId, ratingSection.nightId)}
                className="mt-1"
              >
                <input
                  type="text"
                  name="tag"
                  list="club-tag-options"
                  placeholder="Add a tag"
                  maxLength={50}
                  className="border"
                />
                <datalist id="club-tag-options">
                  {ratingSection.clubTagOptions.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>{" "}
                <button type="submit" className="border px-3 py-1">
                  Add tag
                </button>
              </form>
            </div>
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
                  {r.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-2 text-sm">
                      {r.tags.map((t) => (
                        <Link
                          key={t.name}
                          href={`/clubs/${clubId}/tags/${encodeURIComponent(t.name)}`}
                          className="underline"
                        >
                          {t.displayName}
                        </Link>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
