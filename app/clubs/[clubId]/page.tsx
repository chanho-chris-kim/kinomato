import { and, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import type { ReactNode } from "react";
import { getDb } from "@/db";
import { clubs, constraints, films, nights, nominations, ratings, ratingTags, rsvps, tags } from "@/db/schema";
import { getAutoAdvance, getConfirmAt, getLockTime, getNomineesPerTurn, getShowVoteCounts } from "@/lib/clubSettings";
import { effectiveLockAt, effectiveUnconfirmAt } from "@/lib/nightDeadlines";
import { needsHelp } from "@/lib/nominationHelp";
import { preferenceWarnings } from "@/lib/preferenceWarnings";
import {
  findConfirmableNight,
  findInFlightNight,
  findLateConfirmableNight,
  findLatestWatchedNight,
  findLockedNight,
  formatNightTime,
  nightName,
} from "@/lib/clubStatus";
import { areTakesRevealed, mustRateBeforeReveal } from "@/lib/ratingReveal";
import { getNextPicker, getWhoseTurn, type RotationMembership } from "@/lib/rotation";
import {
  canSayIWasThere,
  isVisiblyRevealed,
  startsIn,
  voteCountsVisible,
  weekStage,
  wonText,
  type WeekStage,
} from "@/lib/tonight";
import { requireClubMember } from "@/app/auth";
import { ClubHeader, ClubTabs, GlobalShell } from "@/app/shell";
import { helpFilmsFor, nominatableFilms } from "@/app/watchlistRead";
import { byJoinedAt, RailMembers } from "./memberViews";
import { loadClubMemberships, nameOf } from "./members";
import { closedTally, liveVotes } from "./historyRead";
import { createDraftNightCore } from "./draftNightCore";
import { PickerNominate, WaitingOnPicker } from "./_tonight/NominateStage";
import { ClubRatings, IWasThereCard, RateForm, YourRating, type RevealedRating } from "./_tonight/RateStage";
import { RsvpCard } from "./_tonight/RsvpCard";
import { buttonClass, StageCard } from "./_tonight/StageCard";
import { ThisWeekGlance, ThisWeekRail, type ThisWeekFacts } from "./_tonight/ThisWeek";
import { VoteStage, type NomineeCard } from "./_tonight/VoteStage";
import { ConfirmCard, LateConfirmCard, LockedHero, type LockedFilm } from "./_tonight/WatchStage";
import { WeekBar } from "./_tonight/WeekBar";

// Tonight (the Tonight redesign, ruled 2026-11-25). Every stage in one
// order: club header and tabs, the week bar, ONE "do this now" card, the
// RSVP card when it applies, then everything else. This file loads the
// facts and picks the card; each stage's card is its own component in
// ./_tonight.

// One card on the page. `stage` ties it to the week bar; `action` says it
// asks something of this viewer.
interface Section {
  key: string;
  stage: WeekStage | null;
  action: boolean;
  render: (main: boolean) => ReactNode;
}

export default async function ClubPage({
  params,
  searchParams,
}: {
  params: Promise<{ clubId: string }>;
  searchParams: Promise<{ joined?: string; pass?: string; passFor?: string; passed?: string; passError?: string }>;
}) {
  const { clubId } = await params;
  const { joined, pass, passFor, passed, passError } = await searchParams;
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  // A Server Component reading the clock once per request, like any other
  // request-time read (react-hooks/purity is aimed at client components).
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const nowDate = new Date(now);

  // Signed in and an active member, or /login (signed out) / 404 (not a
  // member — a 403 would confirm the club exists). docs/onboarding-spec.md
  // §5.1.
  const { membership: me } = await requireClubMember(clubId, `/clubs/${clubId}`);
  const [club] = await db.select().from(clubs).where(eq(clubs.id, clubId));

  const clubMemberships = await loadClubMemberships(db, clubId);
  const activeMemberships = clubMemberships.filter((m) => m.leftAt === null);
  const currentMembership = activeMemberships.find((m) => m.id === me.id)!;
  const isOwnerOrAdmin = currentMembership.role === "owner" || currentMembership.role === "admin";
  const rotationMemberships: RotationMembership[] = clubMemberships.map((m) => ({
    id: m.id,
    userId: m.userId,
    clubId: m.clubId,
    joinedAt: m.joinedAt,
    leftAt: m.leftAt,
    postponedAt: m.postponedAt,
  }));

  let clubNights = await db.select().from(nights).where(eq(nights.clubId, clubId));
  const rotationOf = () => ({
    memberships: rotationMemberships,
    nights: clubNights.map((n) => ({ pickerMembershipId: n.pickerMembershipId, state: n.state, scheduledAt: n.scheduledAt })),
    clubPausedAt: club.pausedAt,
  });

  // ad_hoc has no computable schedule (lib/schedule.ts), so nothing drafts
  // its nights; it gets its own empty state below.
  const adHocNeedsManualNight =
    findInFlightNight(clubNights) === null && getNextPicker(rotationOf()) !== null && club.cadence === "ad_hoc";

  // A night's first draft is created lazily, right here, through the core
  // the hourly job uses too (CLAUDE.md; draftNightCore.ts): whichever runs
  // first wins. Re-read after either, so this load shows the winner.
  const drafted = await createDraftNightCore(db, {
    clubId,
    club,
    memberships: rotationMemberships,
    nights: clubNights,
    now: nowDate,
  });
  if (drafted !== "none") {
    clubNights = await db.select().from(nights).where(eq(nights.clubId, clubId));
  }

  // Who the club is waiting on: the in-flight night's picker, else who picks
  // next (CLAUDE.md "Whose turn"), computed after any lazy draft. Since the
  // redesign it's said in the card's text and the side column.
  const whoseTurnMember = getWhoseTurn(rotationOf());
  const whoseTurn = whoseTurnMember ? clubMemberships.find((m) => m.id === whoseTurnMember.id) : null;
  const inFlight = findInFlightNight(clubNights);
  const nextPicker = inFlight ? getNextPicker(rotationOf()) : null;
  const pickerNameOf = (membershipId: string) =>
    nameOf(clubMemberships.find((m) => m.id === membershipId)) ?? "someone who's left";

  const showVoteCounts = getShowVoteCounts(club.settings);
  const lockTimeHours = getLockTime(club.settings);
  const confirmAt = getConfirmAt(club.settings);

  // ---- The night in flight ----
  const openNight = clubNights.find((n) => n.state === "open") ?? null;
  const draftNight = clubNights.find((n) => n.state === "draft") ?? null;
  const lockedInFlight = clubNights.find((n) => n.state === "locked") ?? null;

  // RSVP stays live through lock (the "RSVP-flip problem", analysis-v1.md
  // §1.2: it never re-runs the filter or moves the pick) and goes once the
  // night has started (ruled 2026-11-24).
  const rsvpableNight =
    clubNights.find((n) => (n.state === "open" || n.state === "locked") && n.scheduledAt.getTime() > now) ?? null;
  const inFlightRsvps = inFlight
    ? await db.select({ membershipId: rsvps.membershipId, status: rsvps.status }).from(rsvps).where(eq(rsvps.nightId, inFlight.id))
    : [];
  const myRsvpStatus = inFlightRsvps.find((r) => r.membershipId === currentMembership.id)?.status ?? null;
  const activeIds = activeMemberships.map((m) => m.id);
  const comingCount = inFlightRsvps.filter((r) => r.status === "yes" && activeIds.includes(r.membershipId)).length;

  // Open: the nominees as poster cards. Counts only when the club shows them
  // while voting is open (ruled 2026-11-25).
  let nomineeCards: NomineeCard[] = [];
  if (openNight) {
    const nightNominations = await db
      .select({
        nominationId: nominations.id,
        filmId: films.id,
        filmTitle: films.title,
        filmYear: films.year,
        posterPath: films.posterPath,
        directors: films.directors,
        genreIds: films.genreIds,
        keywordIds: films.keywordIds,
        runtime: films.runtime,
        originalLanguage: films.originalLanguage,
      })
      .from(nominations)
      .innerJoin(films, eq(nominations.filmId, films.id))
      .where(eq(nominations.nightId, openNight.id))
      .orderBy(nominations.position);

    // Live counts and your own vote, through the history-read module — the
    // only code that reads votes (CLAUDE.md attribution ruling).
    const live = await liveVotes(db, openNight.id, currentMembership.id);
    const countsShown = voteCountsVisible("open", showVoteCounts);

    // "Someone coming would rather not." (ruled 2026-11-18): never a name, a
    // count or which preference.
    const activePreferences = activeIds.length
      ? await db
          .select()
          .from(constraints)
          .where(and(inArray(constraints.membershipId, activeIds), eq(constraints.kind, "soft")))
      : [];
    const warned = preferenceWarnings({
      viewerMembershipId: currentMembership.id,
      activeMembershipIds: activeIds,
      rsvps: inFlightRsvps.filter((r): r is { membershipId: string; status: "yes" | "no" } => r.status !== null),
      preferences: activePreferences,
      films: nightNominations.map((n) => ({
        id: n.filmId,
        genreIds: n.genreIds,
        keywordIds: n.keywordIds,
        runtime: n.runtime,
        originalLanguage: n.originalLanguage,
      })),
    });

    nomineeCards = nightNominations.map((n) => ({
      nominationId: n.nominationId,
      filmTitle: n.filmTitle,
      filmYear: n.filmYear,
      posterPath: n.posterPath,
      director: n.directors[0] ?? null,
      runtime: n.runtime,
      voteCount: countsShown ? (live?.counts[n.nominationId] ?? 0) : null,
      votedByMe: live?.viewerVotedFor === n.nominationId,
      someoneWouldRatherNot: warned.has(n.filmId),
    }));
  }

  // Draft: the picker's own films (app/watchlistRead.ts), and help when
  // there aren't enough (ruled 2026-11-17).
  let myFilms: Awaited<ReturnType<typeof nominatableFilms>> = { films: [], listIsEmpty: true };
  let helpFilms: Awaited<ReturnType<typeof helpFilmsFor>> = [];
  const nomineesPerTurn = getNomineesPerTurn(club.settings);
  if (draftNight && draftNight.pickerMembershipId === currentMembership.id) {
    myFilms = await nominatableFilms(db, clubId, currentMembership.userId);
    if (needsHelp(myFilms.films.length, nomineesPerTurn)) {
      helpFilms = await helpFilmsFor(db, clubId, currentMembership.userId);
    }
  }

  // The night's deadlines as stored on it (ruled 2026-11-21), with the same
  // fallback the hourly job uses for nights from before they were stored.
  const votingClosesLabel = openNight
    ? formatNightTime(effectiveLockAt({ ...openNight, lockTimeHours }), club.timezone)
    : null;
  // A draft's turn passes at scheduled_at − lockTime if voting isn't open.
  const draftDeadlineLabel = draftNight
    ? formatNightTime(new Date(draftNight.scheduledAt.getTime() - lockTimeHours * 3600_000), club.timezone)
    : null;
  const unconfirmLabel = lockedInFlight
    ? formatNightTime(
        effectiveUnconfirmAt({
          ...lockedInFlight,
          confirmAt,
          timezone: club.timezone,
          autoAdvanceHours: getAutoAdvance(club.settings),
        }),
        club.timezone,
      )
    : null;
  const unconfirmNote = unconfirmLabel && (
    <p className="tiny dim mt14 unconfirm-note">
      If nobody answers by {unconfirmLabel}, this week is logged as unconfirmed and the turn moves on.
    </p>
  );

  const filmById = async (filmId: string | null) => {
    if (!filmId) return null;
    const [film] = await db
      .select({ title: films.title, year: films.year, runtime: films.runtime, posterPath: films.posterPath, directors: films.directors })
      .from(films)
      .where(eq(films.id, filmId));
    return film ?? null;
  };

  // "Did you watch X?" once the club's confirm timing allows it; the locked
  // hero until then (never both: one night in flight).
  const confirmableNight = findConfirmableNight(clubNights, confirmAt, club.timezone, nowDate);
  const confirmableFilm = await filmById(confirmableNight?.winningFilmId ?? null);
  const lockedNight = findLockedNight(clubNights, confirmAt, club.timezone, nowDate);
  const lockedFilmRow = await filmById(lockedNight?.winningFilmId ?? null);
  const lockedFilm: LockedFilm | null = lockedFilmRow
    ? { ...lockedFilmRow, director: lockedFilmRow.directors[0] ?? null }
    : null;
  let lockedResult = "";
  if (lockedNight) {
    const tally = await closedTally(db, lockedNight.id);
    lockedResult = (tally && wonText(tally)) ?? `Nobody voted, so ${pickerNameOf(lockedNight.pickerMembershipId)}'s first choice`;
  }

  // "Did you watch X after all?" (ruled 2026-11-21).
  const lateNight = findLateConfirmableNight(clubNights, nowDate);
  const lateFilm = await filmById(lateNight?.winningFilmId ?? null);

  // ---- Rating: the club's latest watched night (blind reveal) ----
  const watchedNight = findLatestWatchedNight(clubNights);
  let rating: {
    nightId: string;
    filmTitle: string;
    myRsvp: "yes" | "no" | null;
    myRated: boolean;
    myTags: { tagId: string; displayName: string }[];
    tagOptions: string[];
    attending: number;
    ratedAttending: number;
    // Every rating, once everyone who came has rated and one exists.
    revealed: RevealedRating[] | null;
    canSayIWasThere: boolean;
    open: boolean;
  } | null = null;
  if (watchedNight?.winningFilmId) {
    const film = await filmById(watchedNight.winningFilmId);
    const [nightRsvps, nightRatings, clubTags] = await Promise.all([
      db.select().from(rsvps).where(eq(rsvps.nightId, watchedNight.id)),
      db.select().from(ratings).where(eq(ratings.nightId, watchedNight.id)),
      // The add-tag autocomplete: every tag the club has used (an accepted,
      // narrow leak, CLAUDE.md tags ruling).
      db.select({ displayName: tags.displayName }).from(tags).where(eq(tags.clubId, clubId)),
    ]);
    const attending = mustRateBeforeReveal(nightRsvps, activeIds);
    const rated = nightRatings.map((r) => r.membershipId);
    const visible = isVisiblyRevealed(attending, rated);
    const ratingIds = nightRatings.map((r) => r.id);
    const nightTags = ratingIds.length
      ? await db
          .select({ ratingId: ratingTags.ratingId, tagId: ratingTags.tagId, name: tags.name, displayName: tags.displayName })
          .from(ratingTags)
          .innerJoin(tags, eq(ratingTags.tagId, tags.id))
          .where(inArray(ratingTags.ratingId, ratingIds))
      : [];
    const mine = nightRatings.find((r) => r.membershipId === currentMembership.id) ?? null;
    const myRsvp = nightRsvps.find((r) => r.membershipId === currentMembership.id)?.status ?? null;
    rating = {
      nightId: watchedNight.id,
      filmTitle: film?.title ?? "this film",
      myRsvp,
      myRated: mine !== null,
      myTags: mine ? nightTags.filter((t) => t.ratingId === mine.id).map((t) => ({ tagId: t.tagId, displayName: t.displayName })) : [],
      tagOptions: clubTags.map((t) => t.displayName),
      attending: attending.length,
      ratedAttending: attending.filter((id) => rated.includes(id)).length,
      revealed:
        visible && areTakesRevealed(attending, rated)
          ? nightRatings.map((r) => ({
              displayName: pickerNameOf(r.membershipId),
              scoreQuality: r.scoreQuality,
              scoreFun: r.scoreFun,
              hotTake: r.hotTake,
              tags: nightTags.filter((t) => t.ratingId === r.id).map((t) => ({ name: t.name, displayName: t.displayName })),
            }))
          : null,
      canSayIWasThere: canSayIWasThere({ nightState: watchedNight.state, myRsvp, revealed: visible }),
      // Someone who came is still to rate.
      open: attending.length > 0 && !areTakesRevealed(attending, rated),
    };
  }
  const ratingProgress =
    rating && !rating.revealed && rating.attending > 0
      ? `${rating.ratedAttending}/${rating.attending} ratings in — hidden until everyone who's coming has rated.`
      : null;

  // ---- The week bar ----
  const stage = weekStage({
    paused: club.pausedAt !== null,
    inFlight: inFlight ? { state: inFlight.state as "draft" | "open" | "locked", scheduledAt: inFlight.scheduledAt } : null,
    ratingsOpen: rating?.open ?? false,
    now: nowDate,
  });

  // First run (§5.10): the owner is the only member and no night has ever
  // finished. Only someone who can add people sees it.
  const isFirstRun =
    activeMemberships.length === 1 &&
    isOwnerOrAdmin &&
    !clubNights.some((n) => ["watched", "cancelled", "unconfirmed"].includes(n.state));

  // ---- The cards, in page order ----
  const sections: Section[] = [];
  if (confirmableNight) {
    sections.push({
      key: "confirm",
      stage: "watch",
      action: true,
      render: (main) => (
        <ConfirmCard
          main={main}
          clubId={clubId}
          nightId={confirmableNight.id}
          nightLabel={nightName(confirmableNight.scheduledAt, club.timezone, nowDate)}
          filmTitle={confirmableFilm?.title ?? null}
          unconfirmNote={unconfirmNote}
        />
      ),
    });
  }
  if (rating) {
    const r = rating;
    if (r.myRsvp === "yes" && !r.myRated) {
      sections.push({
        key: "rate",
        stage: "rate",
        action: true,
        render: (main) => <RateForm main={main} clubId={clubId} nightId={r.nightId} filmTitle={r.filmTitle} progress={ratingProgress} />,
      });
    } else if (r.canSayIWasThere) {
      sections.push({
        key: "i-was-there",
        stage: "rate",
        action: true,
        render: (main) => <IWasThereCard main={main} clubId={clubId} nightId={r.nightId} filmTitle={r.filmTitle} />,
      });
    } else if (r.myRsvp === "yes") {
      sections.push({
        key: "your-rating",
        stage: "rate",
        action: false,
        render: (main) => (
          <YourRating
            main={main}
            clubId={clubId}
            nightId={r.nightId}
            filmTitle={r.filmTitle}
            myTags={r.myTags}
            tagOptions={r.tagOptions}
            progress={ratingProgress}
            revealed={r.revealed}
          />
        ),
      });
    } else if (r.revealed && r.revealed.length > 0) {
      const revealed = r.revealed;
      sections.push({
        key: "club-ratings",
        stage: "rate",
        action: false,
        render: (main) => <ClubRatings main={main} clubId={clubId} filmTitle={r.filmTitle} ratings={revealed} />,
      });
    }
  }
  if (lateNight) {
    sections.push({
      key: "late",
      stage: null,
      action: true,
      render: (main) => <LateConfirmCard main={main} clubId={clubId} nightId={lateNight.id} filmTitle={lateFilm?.title ?? null} />,
    });
  }
  if (isFirstRun) {
    // First run (§5.10): nobody but the owner yet. The one useful thing to
    // do is invite people, from the Members tab.
    sections.push({
      key: "first-run",
      stage: null,
      action: true,
      render: (main) => (
        <StageCard main={main} id="first-run" eyebrow="First night" title="Add the people you watch with.">
          <p className="small muted mt-1">Each person gets their own link that greets them by name.</p>
          <Link href={`/clubs/${clubId}/members#add-person`} className={buttonClass(main, "mt14 block-link")}>
            Add a person
          </Link>
        </StageCard>
      ),
    });
  }
  if (draftNight) {
    const night = draftNight;
    if (night.pickerMembershipId === currentMembership.id) {
      sections.push({
        key: "nominate",
        stage: "nominate",
        action: true,
        render: (main) => (
          <PickerNominate
            main={main}
            clubId={clubId}
            nightId={night.id}
            closesLabel={draftDeadlineLabel}
            films={myFilms.films}
            listIsEmpty={myFilms.listIsEmpty}
            cap={nomineesPerTurn}
            helpFilms={helpFilms}
            passConfirm={Boolean(pass)}
          />
        ),
      });
    } else {
      sections.push({
        key: "waiting",
        stage: "nominate",
        action: false,
        render: (main) => (
          <WaitingOnPicker
            main={main}
            clubId={clubId}
            pickerName={pickerNameOf(night.pickerMembershipId)}
            pickerMembershipId={night.pickerMembershipId}
            canPassFor={isOwnerOrAdmin && activeIds.includes(night.pickerMembershipId)}
            passConfirm={Boolean(passFor)}
          />
        ),
      });
    }
  }
  if (openNight) {
    const night = openNight;
    sections.push({
      key: "vote",
      stage: "vote",
      action: !nomineeCards.some((n) => n.votedByMe),
      render: (main) => (
        <VoteStage
          main={main}
          clubId={clubId}
          nightId={night.id}
          pickerName={pickerNameOf(night.pickerMembershipId)}
          closesLabel={votingClosesLabel}
          nominees={nomineeCards}
          canClose={isOwnerOrAdmin}
        />
      ),
    });
  }
  if (lockedNight && lockedFilm) {
    const night = lockedNight;
    const started = now >= night.scheduledAt.getTime();
    sections.push({
      key: "locked",
      stage: started ? "watch" : "locked",
      action: false,
      render: (main) => (
        <LockedHero
          main={main}
          film={lockedFilm}
          countdown={startsIn(nowDate, night.scheduledAt)}
          started={started}
          result={lockedResult}
          startsLabel={formatNightTime(night.scheduledAt, club.timezone)}
          outByLabel={
            lockedFilm.runtime
              ? formatNightTime(new Date(night.scheduledAt.getTime() + lockedFilm.runtime * 60_000), club.timezone)
              : null
          }
          unconfirmNote={unconfirmNote}
        />
      ),
    });
  }
  if (club.pausedAt) {
    // Paused (§5.10, ruled 2026-11-10): nothing new is scheduled, but a
    // night already in flight carries on.
    sections.push({
      key: "paused",
      stage: null,
      action: false,
      render: (main) => (
        <StageCard main={main} id="paused" eyebrow="Paused" title="This club is paused">
          <p className="small muted mt-1 club-paused-note">This club is paused. The night in progress, if any, carries on.</p>
        </StageCard>
      ),
    });
  }
  if (!inFlight && !confirmableNight && !lateNight && sections.length === 0) {
    sections.push({
      key: "empty",
      stage: null,
      action: false,
      render: (main) =>
        adHocNeedsManualNight ? (
          // "ad_hoc" has no computable next occurrence on purpose: a real,
          // permanent property of such a club, and there's no way yet to
          // schedule one by hand.
          <StageCard main={main} id="empty" eyebrow="No night" title="No night scheduled">
            <p className="small muted mt-1">
              This club is ad hoc — nights aren&apos;t scheduled automatically. There&apos;s no way to schedule one
              manually yet either.
            </p>
          </StageCard>
        ) : clubNights.length === 0 ? (
          // Nobody active to pick: not the common case, a real one.
          <StageCard main={main} id="empty" eyebrow="No night" title="No night scheduled yet">
            <p className="small muted mt-1">
              This club hasn&apos;t had a movie night yet. Invite the people you watch with from the{" "}
              <Link href={`/clubs/${clubId}/members`} className="underline">
                Members
              </Link>{" "}
              tab — each gets their own link.
            </p>
          </StageCard>
        ) : (
          <StageCard main={main} id="empty" eyebrow="No night" title="Nothing to do right now">
            <p className="small muted mt-1">No open vote right now.</p>
          </StageCard>
        ),
    });
  }

  // The "do this now" card: an action at the week's current step, else any
  // action, else what the current step is, else the first card.
  const main =
    sections.find((s) => s.action && s.stage === stage) ??
    sections.find((s) => s.action) ??
    sections.find((s) => s.stage === stage) ??
    sections[0];
  const rest = sections.filter((s) => s !== main);

  // ---- This week: the side column, and the phone's glance ----
  const watchedNights = clubNights
    .filter((n) => n.state === "watched" && n.winningFilmId)
    .sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime())
    .slice(0, 3);
  const watchedFilms = watchedNights.length
    ? await db
        .select({ id: films.id, title: films.title })
        .from(films)
        .where(inArray(films.id, watchedNights.map((n) => n.winningFilmId!)))
    : [];
  const dateFormat = new Intl.DateTimeFormat("en-US", { timeZone: club.timezone, month: "short", day: "numeric" });
  const watched = watchedNights.map((n) => ({
    nightId: n.id,
    title: watchedFilms.find((f) => f.id === n.winningFilmId)?.title ?? "A film",
    date: dateFormat.format(n.scheduledAt),
  }));
  const facts: ThisWeekFacts = {
    night: inFlight ? formatNightTime(inFlight.scheduledAt, club.timezone) : null,
    status: votingClosesLabel
      ? `Voting closes ${votingClosesLabel}`
      : inFlight && inFlight.state !== "draft"
        ? `${comingCount} coming`
        : null,
    picking: whoseTurn ? nameOf(whoseTurn) : "Nobody active in this club.",
    nextTurn: nextPicker ? pickerNameOf(nextPicker.id) : null,
  };
  const weekday = rsvpableNight
    ? new Intl.DateTimeFormat("en-US", { timeZone: club.timezone, weekday: "long" }).format(rsvpableNight.scheduledAt)
    : "";

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
        <ThisWeekRail
          clubId={clubId}
          facts={facts}
          watched={watched}
          members={
            <RailMembers
              members={[...activeMemberships].sort(byJoinedAt)}
              meId={currentMembership.id}
              addPersonHref={isOwnerOrAdmin ? `/clubs/${clubId}/members#add-person` : undefined}
            />
          }
        />
      }
    >
      {passed && (
        <div className="note mt14">
          <p className="small flush" role="status">
            Turn passed. The next person picks this time.
          </p>
        </div>
      )}
      {passError && (
        <p className="small mt14 warn" role="alert">
          {passError}
        </p>
      )}
      {joined && (
        <div className="note mt14">
          <p className="small flush">You&apos;re in, {nameOf(currentMembership)}.</p>
        </div>
      )}

      {stage && <WeekBar stage={stage} />}
      {main?.render(true)}
      {rsvpableNight && (
        <RsvpCard
          clubId={clubId}
          nightId={rsvpableNight.id}
          weekday={weekday}
          status={myRsvpStatus}
          locked={rsvpableNight.state === "locked"}
        />
      )}
      {rest.map((s) => (
        <div key={s.key}>{s.render(false)}</div>
      ))}
      <ThisWeekGlance clubId={clubId} facts={facts} watched={watched} />
    </GlobalShell>
  );
}
