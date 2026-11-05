import { and, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { getDb } from "@/db";
import {
  clubs,
  films,
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
import {
  findConfirmableNight,
  findInFlightNight,
  findLatestWatchedNight,
  findLockedNight,
  getDraftToCreate,
} from "@/lib/clubStatus";
import { areTakesRevealed } from "@/lib/ratingReveal";
import {
  getNextPicker,
  getWhoseTurn,
  type RotationMembership,
  type RotationNight,
} from "@/lib/rotation";
import {
  addRatingTag,
  castVote,
  confirmNight,
  lockNight,
  openVoting,
  removeRatingTag,
  setRsvp,
  submitRating,
} from "./actions";
import { requireClubMember } from "@/app/auth";
import { ClubHeader, ClubTabs, GlobalShell } from "@/app/shell";
import { byJoinedAt, RailMembers } from "./memberViews";
import { loadClubMemberships, nameOf } from "./members";
import { NominationSelector } from "./NominationSelector";
import { RatingSlider } from "./RatingSlider";

export default async function ClubPage({
  params,
  searchParams,
}: {
  params: Promise<{ clubId: string }>;
  searchParams: Promise<{ joined?: string }>;
}) {
  const { clubId } = await params;
  const { joined } = await searchParams;
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  // react-hooks/purity is a React Compiler rule aimed at client
  // components it might memoize; this is a Server Component that reads
  // the database (already impure) once per request and is never
  // recompiled client-side, so "current time" here is no different in
  // kind from any other request-time read above.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  // Signed in and an active member, or /login (signed out) / 404 (not a
  // member — a 403 would confirm the club exists). docs/onboarding-spec.md
  // §5.1.
  const { membership: me } = await requireClubMember(clubId, `/clubs/${clubId}`);
  const [club] = await db.select().from(clubs).where(eq(clubs.id, clubId));

  const clubMemberships = await loadClubMemberships(db, clubId);
  const activeMemberships = clubMemberships.filter((m) => m.leftAt === null);
  const currentMembership = activeMemberships.find((m) => m.id === me.id)!;

  let clubNights = await db.select().from(nights).where(eq(nights.clubId, clubId));

  // Who picks next — used only for the ad hoc empty state below (lazy
  // draft creation computes its own, in getDraftToCreate). Not what
  // "Whose turn" displays: that's getWhoseTurn, computed after the insert
  // (CLAUDE.md ruling).
  const rotationMemberships: RotationMembership[] = clubMemberships.map((m) => ({
    id: m.id,
    userId: m.userId,
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

  // A night's first draft row is created lazily, right here (CLAUDE.md's
  // load-bearing rulings) — whichever page load first finds the club
  // with no non-terminal night and a resolvable next picker creates one.
  // lib/clubStatus.ts's getDraftToCreate decides; `/` uses the same
  // function for display only. ad_hoc has no computable schedule
  // (lib/schedule.ts returns null for it on purpose) — the ad_hoc-specific
  // empty state below explains that rather than this silently doing
  // nothing.
  const hasNonTerminalNight = findInFlightNight(clubNights) !== null;
  const adHocNeedsManualNight =
    !hasNonTerminalNight && whoseTurnResult !== null && club.cadence === "ad_hoc";

  const draftToCreate = getDraftToCreate({
    club,
    memberships: rotationMemberships,
    nights: clubNights,
    now: new Date(now),
  });
  if (draftToCreate) {
    try {
      await db.insert(nights).values({
        clubId,
        scheduledAt: draftToCreate.scheduledAt,
        pickerMembershipId: draftToCreate.pickerMembershipId,
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

  // "Whose turn" is who the club is waiting on: the in-flight night's
  // picker if there is one, else who picks next (CLAUDE.md ruling). Read
  // from clubNights *after* any lazy-create above, so the load that
  // creates a draft and every later load give the same answer, and it
  // always agrees with "Waiting on X to nominate" below.
  const whoseTurnMember = getWhoseTurn({
    memberships: rotationMemberships,
    nights: clubNights.map((n) => ({
      pickerMembershipId: n.pickerMembershipId,
      state: n.state,
      scheduledAt: n.scheduledAt,
    })),
    clubPausedAt: club.pausedAt,
  });
  const whoseTurn = whoseTurnMember
    ? clubMemberships.find((m) => m.id === whoseTurnMember.id)
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
      nameOf(clubMemberships.find((m) => m.id === openNight.pickerMembershipId)) ??
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
      nameOf(clubMemberships.find((m) => m.id === draftNight.pickerMembershipId)) ??
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
  const confirmableNight = findConfirmableNight(clubNights, confirmAt, club.timezone, new Date(now));

  let confirmableFilmTitle: string | null = null;
  if (confirmableNight?.winningFilmId) {
    const [film] = await db
      .select({ title: films.title })
      .from(films)
      .where(eq(films.id, confirmableNight.winningFilmId));
    confirmableFilmTitle = film?.title ?? null;
  }

  // Locked-in display (docs/prototype.html's lockedView — "keep the
  // runtime math" per the styling brief): the window between lock and
  // the confirmAt threshold used to render nothing at all. Pure display
  // over data already on hand — films.runtime, nights.scheduledAt — no
  // new queries beyond the winning film's runtime alongside its title,
  // no new writes, no new user action. Never both this and
  // confirmableNight at once: "one night in flight" means at most one
  // non-terminal night exists, so as soon as it's confirmable this
  // section stops matching and the prompt below takes over.
  const lockedNight = findLockedNight(clubNights, confirmAt, club.timezone, new Date(now));

  let lockedFilm: { title: string; year: number; runtime: number | null } | null = null;
  let lockedStartsLabel: string | null = null;
  let lockedOutByLabel: string | null = null;
  if (lockedNight?.winningFilmId) {
    const [film] = await db
      .select({ title: films.title, year: films.year, runtime: films.runtime })
      .from(films)
      .where(eq(films.id, lockedNight.winningFilmId));
    lockedFilm = film ?? null;

    const timeFormat = new Intl.DateTimeFormat("en-US", {
      timeZone: club.timezone,
      hour: "numeric",
      minute: "2-digit",
    });
    lockedStartsLabel = timeFormat.format(lockedNight.scheduledAt);
    if (lockedFilm?.runtime) {
      const endsAt = new Date(lockedNight.scheduledAt.getTime() + lockedFilm.runtime * 60_000);
      lockedOutByLabel = timeFormat.format(endsAt);
    }
  }

  // Rating (analysis-v1.md §1.1 stage 10, "then ratings and one-line
  // takes") — the club's most recently watched night, so this only ever
  // surfaces the one confirmation just produced, not a backlog of every
  // watched night in the club's history. "Attending" (both for who gets
  // the form and for the blind-reveal denominator) means an explicit
  // yes-RSVP, matching the constraint scoping asymmetry elsewhere.
  const mostRecentWatchedNight = findLatestWatchedNight(clubNights);

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
              nameOf(clubMemberships.find((m) => m.id === r.membershipId)) ??
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

  // First run (§5.10): the owner is the only member and no night has ever
  // finished. ("No nights at all" never holds: the first page load lazily
  // creates the owner's draft night.) Only someone who can add people sees
  // it — the link goes to the owner/admin-only Add a person form.
  const isFirstRun =
    activeMemberships.length === 1 &&
    (currentMembership.role === "owner" || currentMembership.role === "admin") &&
    !clubNights.some((n) => ["watched", "cancelled", "unconfirmed"].includes(n.state));

  // Whether the rating section renders anything for this viewer (see the
  // comment on it below): the empty-state fallback keys on this, not on
  // whether a watched night exists.
  const ratingShown =
    ratingSection !== null &&
    (ratingSection.myRsvpYes ||
      (ratingSection.revealed && ratingSection.revealedRatings.length > 0));

  return (
    <GlobalShell
      current="clubs"
      header={
        <>
          <ClubHeader club={club} />
          <ClubTabs clubId={clubId} current="tonight" />
        </>
      }
      rail={
        <RailMembers
          members={[...activeMemberships].sort(byJoinedAt)}
          meId={currentMembership.id}
          addPersonHref={
            currentMembership.role === "owner" || currentMembership.role === "admin"
              ? `/clubs/${clubId}/members#add-person`
              : undefined
          }
        />
      }
    >
      {joined && (
        <div className="note mt20">
          <p className="small" style={{ margin: 0 }}>
            You&apos;re in, {nameOf(currentMembership).replace(/ [A-Za-z]\.$/, "")}.
          </p>
        </div>
      )}

      {isFirstRun && (
        // First run (§5.10): nobody but the owner yet. The one useful
        // thing to do is invite people, from the Members tab.
        <div className="mt20">
          <p className="eyebrow">First night</p>
          <h2 className="h-display" style={{ fontSize: 22 }}>
            Add the people you watch with.
          </h2>
          <p className="small muted mt-1">
            Each person gets their own link that greets them by name.
          </p>
          <Link
            href={`/clubs/${clubId}/members#add-person`}
            className="btn primary mt14"
            style={{ display: "block", textAlign: "center" }}
          >
            Add a person
          </Link>
        </div>
      )}

      <h2 className="sec mt20">Whose turn</h2>
      <p className="small">{whoseTurn ? nameOf(whoseTurn) : "Nobody active in this club."}</p>

      {draftNight &&
        (draftNight.pickerMembershipId === currentMembership.id ? (
          <>
            <p className="eyebrow mt20">Your turn this week</p>
            <h2 className="h-display" style={{ fontSize: 22 }}>
              Your turn to nominate
            </h2>
            {myWatchlistFilms.length === 0 ? (
              <p className="small muted mt14">
                Your watchlist is empty.{" "}
                <Link href={`/clubs/${clubId}/list`} className="underline">
                  Add films to it
                </Link>{" "}
                before you can nominate.
              </p>
            ) : (
              <form action={openVoting.bind(null, clubId, draftNight.id)} className="mt14">
                <NominationSelector films={myWatchlistFilms} cap={nomineesPerTurn} />
              </form>
            )}
          </>
        ) : (
          <p className="small muted mt20">Waiting on {draftPickerName} to nominate.</p>
        ))}

      {!openNight &&
        !draftNight &&
        !lockedNight &&
        !confirmableNight &&
        !ratingShown &&
        (adHocNeedsManualNight ? (
          // "ad_hoc" has no computable next occurrence on purpose
          // (lib/schedule.ts) — an ad-hoc club doesn't have a standing
          // day/time to compute from, so lazy-creation can't fire here.
          // Named explicitly so this reads as a real, permanent property
          // of an ad_hoc club rather than a bug — there's no UI yet to
          // schedule one manually either (a real gap, not solved here).
          <>
            <h2 className="h-display mt20" style={{ fontSize: 20 }}>
              No night scheduled
            </h2>
            <p className="small muted mt-1">
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
            <h2 className="h-display mt20" style={{ fontSize: 20 }}>
              No night scheduled yet
            </h2>
            <p className="small muted mt-1">
              This club hasn&apos;t had a movie night yet. Invite the people you
              watch with from the{" "}
              <Link href={`/clubs/${clubId}/members`} className="underline">
                Members
              </Link>{" "}
              tab — each gets their own link.
            </p>
          </>
        ) : (
          <p className="small muted mt20">No open vote right now.</p>
        ))}

      {rsvpableNight && (
        <>
          {openNight && (
            <h2 className="h-display mt20" style={{ fontSize: 22 }}>
              This week&apos;s pick, nominated by {pickerName}
            </h2>
          )}

          <h3 className="sec mt20">RSVP</h3>
          <p className="small muted">Current answer: {myRsvpStatus ?? "no answer yet"}</p>
          <div className="row gap8 mt14">
            <form action={setRsvp.bind(null, clubId, rsvpableNight.id, "yes")} style={{ flex: 1 }}>
              <button type="submit" className={`btn ${myRsvpStatus === "yes" ? "primary" : ""}`}>
                Going
              </button>
            </form>
            <form action={setRsvp.bind(null, clubId, rsvpableNight.id, "no")} style={{ flex: 1 }}>
              <button type="submit" className={`btn ${myRsvpStatus === "no" ? "primary" : ""}`}>
                Not going
              </button>
            </form>
          </div>
        </>
      )}

      {openNight && (
        <>
          <h3 className="sec mt20">Nominees</h3>
          <ul className="stack gap8 mt14">
            {nomineeRows.map((n) => (
              <li key={n.nominationId} className="nominee">
                <div className="small">
                  {n.filmTitle} ({n.filmYear}) — {n.voteCount}{" "}
                  {n.voteCount === 1 ? "vote" : "votes"}
                  {n.votedByMe && " — your vote"}
                </div>
                <form action={castVote.bind(null, clubId, n.nominationId)} className="mt14">
                  <button type="submit" className="btn">
                    {n.votedByMe ? "Voted" : "Vote"}
                  </button>
                </form>
              </li>
            ))}
          </ul>

          {(currentMembership.role === "owner" || currentMembership.role === "admin") && (
            <div className="mt20">
              <form action={lockNight.bind(null, clubId, openNight.id)}>
                <button type="submit" className="btn primary">
                  Close voting and set the pick
                </button>
              </form>
              <p className="tiny dim mt-1">The pick can&apos;t be changed after this.</p>
            </div>
          )}
        </>
      )}

      {lockedNight && lockedFilm && (
        <>
          <div className="between mt20" style={{ alignItems: "center" }}>
            <span className="pill">Locked in</span>
          </div>
          <h2 className="h-display mt14" style={{ fontSize: 26 }}>
            {lockedFilm.title}
          </h2>
          <p className="small muted mt-1">{lockedFilm.year}</p>
          <div
            className="row between"
            style={{
              borderTop: "1px solid var(--line)",
              borderBottom: "1px solid var(--line)",
              padding: "13px 0",
              margin: "18px 0",
            }}
          >
            <div>
              <div className="tiny dim">starts</div>
              <div style={{ fontSize: 17 }}>{lockedStartsLabel}</div>
            </div>
            <div>
              <div className="tiny dim">runs</div>
              <div style={{ fontSize: 17 }}>
                {lockedFilm.runtime !== null ? `${lockedFilm.runtime}m` : "—"}
              </div>
            </div>
            <div>
              <div className="tiny dim">out by</div>
              <div style={{ fontSize: 17, color: "var(--accent)" }}>
                {lockedOutByLabel ?? "—"}
              </div>
            </div>
          </div>
        </>
      )}

      {confirmableNight && (
        <>
          <p className="eyebrow mt20">Sunday morning</p>
          <h2 className="h-display" style={{ fontSize: 22 }}>
            Did you watch {confirmableFilmTitle ?? "it"}?
          </h2>
          <div className="row gap8 mt14">
            <form
              action={confirmNight.bind(null, clubId, confirmableNight.id, "watched")}
              style={{ flex: 1 }}
            >
              <button type="submit" className="btn primary">
                Yes
              </button>
            </form>
            <form
              action={confirmNight.bind(null, clubId, confirmableNight.id, "cancelled")}
              style={{ flex: 1 }}
            >
              <button type="submit" className="btn ghost">
                We didn&apos;t meet
              </button>
            </form>
          </div>
        </>
      )}

      {/* Rating (blind reveal, CLAUDE.md). Only someone who RSVP'd yes can
          rate, so only they get "Rate X" — the form, then their tags and the
          progress line once they've rated. Anyone else sees nothing here
          until every rating is in, then just the revealed ratings: revealed
          ratings are visible to every member, and Tonight is where they
          appear until the History tab exists (rebuild step 5f). */}
      {ratingSection &&
        !ratingSection.myRsvpYes &&
        ratingSection.revealed &&
        ratingSection.revealedRatings.length > 0 && (
          <>
            <h2 className="h-display mt20" style={{ fontSize: 22 }}>
              How the club rated {ratingSection.filmTitle}
            </h2>
            <RevealedRatings ratings={ratingSection.revealedRatings} clubId={clubId} />
          </>
        )}

      {ratingSection && ratingSection.myRsvpYes && (
        <>
          <h2 className="h-display mt20" style={{ fontSize: 22 }}>
            Rate {ratingSection.filmTitle}
          </h2>

          {ratingSection.myRsvpYes && !ratingSection.myRating && (
            <form
              action={submitRating.bind(null, clubId, ratingSection.nightId)}
              className="stack gap14 mt14"
            >
              <RatingSlider name="scoreQuality" label="Quality" />
              <RatingSlider name="scoreFun" label="Fun" />
              <div>
                <label className="small muted">
                  One-line take (optional)
                  <div className="search mt-1">
                    <input type="text" name="hotTake" maxLength={140} />
                  </div>
                </label>
              </div>
              <button type="submit" className="btn primary">
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
            <div className="mt20">
              <h3 className="sec">Your tags</h3>
              {ratingSection.myTags.length > 0 && (
                <ul className="row gap8 mt-1" style={{ flexWrap: "wrap" }}>
                  {ratingSection.myTags.map((t) => (
                    <li key={t.tagId} className="chip">
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
                className="row gap8 mt14"
              >
                <div className="search" style={{ flex: 1 }}>
                  <input
                    type="text"
                    name="tag"
                    list="club-tag-options"
                    placeholder="Add a tag"
                    maxLength={50}
                  />
                </div>
                <datalist id="club-tag-options">
                  {ratingSection.clubTagOptions.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
                <button type="submit" className="btn" style={{ width: "auto" }}>
                  Add tag
                </button>
              </form>
            </div>
          )}

          {!ratingSection.revealed && ratingSection.attendingCount > 0 && (
            <p className="tiny dim mt14">
              {ratingSection.ratedAttendingCount}/{ratingSection.attendingCount} ratings
              in — hidden until everyone who&apos;s coming has rated.
            </p>
          )}

          {ratingSection.revealed && (
            <RevealedRatings ratings={ratingSection.revealedRatings} clubId={clubId} />
          )}
        </>
      )}
    </GlobalShell>
  );
}

// The blind reveal's result: every attending member's scores, hot take and
// tags, shown only once all of them have rated.
function RevealedRatings({
  ratings,
  clubId,
}: {
  ratings: {
    displayName: string;
    scoreQuality: string;
    scoreFun: string;
    hotTake: string | null;
    tags: { name: string; displayName: string }[];
  }[];
  clubId: string;
}) {
  return (
    <ul className="stack gap8 mt14">
      {ratings.map((r, i) => (
        <li key={i} className="card">
          <div className="between">
            <span className="small">{r.displayName}</span>
            <span className="tiny">
              <span className="muted">quality {r.scoreQuality}</span>,{" "}
              <span style={{ color: "var(--accent)" }}>fun {r.scoreFun}</span>
            </span>
          </div>
          {r.hotTake && (
            <p className="small muted mt-1" style={{ fontStyle: "italic" }}>
              &quot;{r.hotTake}&quot;
            </p>
          )}
          {r.tags.length > 0 && (
            <div className="row gap8 mt-1" style={{ flexWrap: "wrap" }}>
              {r.tags.map((t) => (
                <Link
                  key={t.name}
                  href={`/clubs/${clubId}/tags/${encodeURIComponent(t.name)}`}
                  className="chip"
                >
                  {t.displayName}
                </Link>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
