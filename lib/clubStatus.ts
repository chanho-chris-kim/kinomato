import { isConfirmable, type ConfirmAt } from "./confirmTiming";
import {
  getNextPicker,
  getWhoseTurn,
  type NightState,
  type RotationMembership,
} from "./rotation";
import { getScheduleAnchor } from "./clubSettings";
import { getNextOccurrence, type ScheduleConfig } from "./schedule";

// A club's state, derived the same way on its card on `/` (Ruling A,
// docs/onboarding-spec.md §5.7.1) and on its own Tonight page
// (app/clubs/[clubId]/page.tsx). Pure: callers load the rows, this decides.

export interface StatusNight {
  id: string;
  pickerMembershipId: string;
  state: NightState;
  scheduledAt: Date;
  winningFilmId: string | null;
}

export interface StatusClub extends ScheduleConfig {
  pausedAt: Date | null;
  createdAt: Date;
  // clubs.settings, for its schedule anchor (getScheduleAnchor).
  settings?: unknown;
}

// The club's schedule, with "First night on" when it has one.
const scheduleOf = (club: StatusClub): ScheduleConfig => ({ ...club, scheduleAnchor: getScheduleAnchor(club.settings) });

const IN_FLIGHT: readonly NightState[] = ["draft", "open", "locked"];

// "A club has at most one night in flight" is a database guarantee
// (CLAUDE.md), so the first match is the only one.
export function findInFlightNight<N extends StatusNight>(nights: N[]): N | null {
  return nights.find((n) => IN_FLIGHT.includes(n.state)) ?? null;
}

// "Did you watch X?": an in-flight night with a winner (in practice only a
// locked one — lock writes the winner) once the club's confirmAt timing
// allows it.
export function findConfirmableNight<N extends StatusNight>(
  nights: N[],
  confirmAt: ConfirmAt,
  timeZone: string,
  now: Date,
): N | null {
  return (
    nights.find(
      (n) =>
        IN_FLIGHT.includes(n.state) &&
        n.winningFilmId !== null &&
        isConfirmable(confirmAt, n.scheduledAt, timeZone, now),
    ) ?? null
  );
}

// Locked in, and not confirmable yet. Never the same moment as
// findConfirmableNight: as soon as the night is confirmable, this stops
// matching.
export function findLockedNight<N extends StatusNight>(
  nights: N[],
  confirmAt: ConfirmAt,
  timeZone: string,
  now: Date,
): N | null {
  if (findConfirmableNight(nights, confirmAt, timeZone, now)) return null;
  return nights.find((n) => n.state === "locked" && n.winningFilmId !== null) ?? null;
}

// The night ratings are open for: the club's most recently watched one.
export function findLatestWatchedNight<N extends StatusNight>(nights: N[]): N | null {
  return (
    nights
      .filter((n) => n.state === "watched")
      .sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime())[0] ?? null
  );
}

// The draft night the club page creates lazily on load (CLAUDE.md ruling):
// nothing in flight, someone to pick, and a schedule to compute from. Only
// the club page inserts it; `/` uses it for display, never to insert.
export function getDraftToCreate(input: {
  club: StatusClub;
  memberships: RotationMembership[];
  nights: StatusNight[];
  now: Date;
}): { pickerMembershipId: string; scheduledAt: Date } | null {
  const { club, memberships, nights, now } = input;
  if (findInFlightNight(nights)) return null;
  if (club.cadence === "ad_hoc") return null;
  const picker = getNextPicker({ memberships, nights, clubPausedAt: club.pausedAt });
  if (!picker) return null;
  const scheduledAt = getNextOccurrence(scheduleOf(club), now, club.createdAt);
  if (!scheduledAt) return null;
  return { pickerMembershipId: picker.id, scheduledAt };
}

export type ClubStatus =
  | { kind: "nominate" }
  | { kind: "vote" }
  | { kind: "voting"; pickerMembershipId: string }
  | { kind: "locked"; filmId: string }
  | { kind: "confirm"; filmId: string }
  | { kind: "rate"; filmId: string }
  | { kind: "next"; pickerMembershipId: string | null };

export interface ClubStatusInput {
  viewerMembershipId: string;
  club: StatusClub;
  // Every membership, left ones too (rotation carry-forward needs them).
  memberships: RotationMembership[];
  nights: StatusNight[];
  confirmAt: ConfirmAt;
  now: Date;
  // The viewer's own vote on the open night: the only vote read a card
  // makes (CLAUDE.md's attribution ruling allows a member's own vote).
  viewerVotedOnOpenNight: boolean;
  // The viewer on the latest watched night, if there is one.
  viewerOnLatestWatched: { rsvpYes: boolean; rated: boolean } | null;
}

// Exactly one status line, in this priority (Ruling A):
//   your turn to nominate → voting, you haven't voted → confirmable →
//   rate → voting, you have → locked → who picks next.
// Every action line comes before every non-action one, so an action is
// never hidden ("the most actionable true thing"). All but rate come from
// the one in-flight night, so they can't overlap each other. Rate comes
// from the latest watched night, a different night, so it can be true
// alongside any of them; the order above decides.
export function getClubStatus(input: ClubStatusInput): ClubStatus {
  const { viewerMembershipId: me, club, memberships, confirmAt, now } = input;

  // With nothing in flight, the club page would create the next picker's
  // draft on load: treat that draft as here, for display.
  const draft = getDraftToCreate({ club, memberships, nights: input.nights, now });
  const nights: StatusNight[] = draft
    ? [...input.nights, { id: "", state: "draft", winningFilmId: null, ...draft }]
    : input.nights;

  const inFlight = findInFlightNight(nights);
  if (inFlight?.state === "draft" && inFlight.pickerMembershipId === me) return { kind: "nominate" };
  if (inFlight?.state === "open" && !input.viewerVotedOnOpenNight) return { kind: "vote" };
  const confirmable = findConfirmableNight(nights, confirmAt, club.timezone, now);
  if (confirmable?.winningFilmId) return { kind: "confirm", filmId: confirmable.winningFilmId };

  const watched = findLatestWatchedNight(nights);
  if (
    watched?.winningFilmId &&
    input.viewerOnLatestWatched?.rsvpYes &&
    !input.viewerOnLatestWatched.rated
  ) {
    return { kind: "rate", filmId: watched.winningFilmId };
  }

  if (inFlight?.state === "open") {
    return { kind: "voting", pickerMembershipId: inFlight.pickerMembershipId };
  }
  const locked = findLockedNight(nights, confirmAt, club.timezone, now);
  if (locked?.winningFilmId) return { kind: "locked", filmId: locked.winningFilmId };

  // Who the club is waiting on: the in-flight night's picker, else who the
  // rotation puts next — the club page's "Whose turn" (CLAUDE.md ruling).
  const whose = getWhoseTurn({ memberships, nights, clubPausedAt: club.pausedAt });
  return { kind: "next", pickerMembershipId: whose?.id ?? null };
}

export function isActionStatus(status: ClubStatus): boolean {
  return (
    status.kind === "nominate" ||
    status.kind === "vote" ||
    status.kind === "confirm" ||
    status.kind === "rate"
  );
}

export function statusText(
  status: ClubStatus,
  ctx: {
    viewerMembershipId: string;
    nameOf: (membershipId: string) => string;
    filmTitle: (filmId: string) => string;
  },
): string {
  switch (status.kind) {
    case "nominate":
      // No "by Thu": there's no nomination deadline data. Never invent one.
      return "Your turn to nominate";
    case "vote":
      return "Voting — you haven't voted";
    case "voting":
      return status.pickerMembershipId === ctx.viewerMembershipId
        ? "Voting — you're picking"
        : `Voting — ${ctx.nameOf(status.pickerMembershipId)} is picking`;
    case "locked":
      return `${ctx.filmTitle(status.filmId)}, locked in`;
    case "confirm":
      return `Did you watch ${ctx.filmTitle(status.filmId)}?`;
    case "rate":
      return `Rate ${ctx.filmTitle(status.filmId)}`;
    case "next":
      if (status.pickerMembershipId === null) return "Nobody picks while paused";
      return status.pickerMembershipId === ctx.viewerMembershipId
        ? "You pick next"
        : `${ctx.nameOf(status.pickerMembershipId)} picks next`;
  }
}

export type NextNight = { kind: "at"; at: Date } | { kind: "none" } | { kind: "paused" };

// The card's date line: an in-flight night's own time; else nothing for an
// ad hoc club, "Paused" for a paused one, or the computed next occurrence
// (display only — `/` never inserts a night).
export function getNextNight(input: { club: StatusClub; nights: StatusNight[]; now: Date }): NextNight {
  const { club, nights, now } = input;
  const inFlight = findInFlightNight(nights);
  if (inFlight) return { kind: "at", at: inFlight.scheduledAt };
  if (club.cadence === "ad_hoc") return { kind: "none" };
  if (club.pausedAt) return { kind: "paused" };
  const at = getNextOccurrence(scheduleOf(club), now, club.createdAt);
  return at ? { kind: "at", at } : { kind: "none" };
}

export function nextNightText(next: NextNight, timeZone: string): string {
  switch (next.kind) {
    case "at":
      return formatNightTime(next.at, timeZone);
    case "none":
      return "No night scheduled";
    case "paused":
      return "Paused";
  }
}

// "Sat 8:00pm", in the club's timezone.
export function formatNightTime(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("hour")}:${part("minute")}${part("dayPeriod").toLowerCase()}`;
}

// Clubs needing your action first, then the soonest night (no date last),
// then name.
export function sortClubCards<T extends { action: boolean; nextAt: Date | null; name: string }>(
  cards: T[],
): T[] {
  return [...cards].sort((a, b) => {
    if (a.action !== b.action) return a.action ? -1 : 1;
    if (a.nextAt && b.nextAt && a.nextAt.getTime() !== b.nextAt.getTime()) {
      return a.nextAt.getTime() - b.nextAt.getTime();
    }
    if (!a.nextAt !== !b.nextAt) return a.nextAt ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
