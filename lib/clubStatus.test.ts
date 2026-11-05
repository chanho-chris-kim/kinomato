import { describe, expect, it } from "vitest";
import {
  findConfirmableNight,
  findInFlightNight,
  findLatestWatchedNight,
  findLockedNight,
  formatNightTime,
  getClubStatus,
  getDraftToCreate,
  getNextNight,
  isActionStatus,
  nextNightText,
  sortClubCards,
  statusText,
  type ClubStatusInput,
  type StatusClub,
  type StatusNight,
} from "./clubStatus";
import type { RotationMembership } from "./rotation";

// Wednesday 4 Nov 2026, noon in New York (UTC−5 since 1 Nov).
const NOW = new Date("2026-11-04T17:00:00Z");
// The club's next standing night: Saturday 7 Nov, 8pm New York.
const NEXT_SAT = new Date("2026-11-08T01:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const ME = "m-me";
const LOU = "m-lou";
const FILM = "f-thief";

const NAMES: Record<string, string> = { [ME]: "Kit K.", [LOU]: "Lou B." };
const TITLES: Record<string, string> = { [FILM]: "Thief", "f-old": "The Thing" };
const text = (s: ReturnType<typeof getClubStatus>) =>
  statusText(s, { viewerMembershipId: ME, nameOf: (id) => NAMES[id], filmTitle: (id) => TITLES[id] });

function membership(id: string, joinedDay: number): RotationMembership {
  return {
    id,
    userId: `u-${id}`,
    clubId: "c",
    joinedAt: new Date(Date.UTC(2026, 0, joinedDay)),
    leftAt: null,
    postponedAt: null,
  };
}

const CLUB: StatusClub = {
  cadence: "weekly",
  defaultDay: 6,
  defaultTime: "20:00",
  timezone: "America/New_York",
  pausedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

function night(overrides: Partial<StatusNight> & Pick<StatusNight, "state">): StatusNight {
  return {
    id: `n-${overrides.state}`,
    pickerMembershipId: LOU,
    scheduledAt: NEXT_SAT,
    winningFilmId: null,
    ...overrides,
  };
}

// Lou joined first, so with no picks yet Lou is next in the rotation.
function input(overrides: Partial<ClubStatusInput> = {}): ClubStatusInput {
  return {
    viewerMembershipId: ME,
    club: CLUB,
    memberships: [membership(LOU, 1), membership(ME, 2)],
    nights: [],
    confirmAt: "morning_after",
    now: NOW,
    viewerVotedOnOpenNight: false,
    viewerOnLatestWatched: null,
    ...overrides,
  };
}

const watched = (overrides: Partial<StatusNight> = {}) =>
  night({
    state: "watched",
    id: "n-watched",
    // Kit picked it, so Lou is next in the rotation afterwards.
    pickerMembershipId: ME,
    scheduledAt: new Date(NOW.getTime() - 3 * DAY),
    winningFilmId: FILM,
    ...overrides,
  });

describe("getClubStatus: each status line", () => {
  it("your turn to nominate, on your draft night", () => {
    const s = getClubStatus(input({ nights: [night({ state: "draft", pickerMembershipId: ME })] }));
    expect(text(s)).toBe("Your turn to nominate");
    expect(isActionStatus(s)).toBe(true);
  });

  it("your turn to nominate when no night is in flight and you pick next: the club page would create your draft", () => {
    const s = getClubStatus(input({ memberships: [membership(ME, 1), membership(LOU, 2)] }));
    expect(text(s)).toBe("Your turn to nominate");
    expect(isActionStatus(s)).toBe(true);
  });

  it("an ad hoc club can't create a draft, so picking next isn't a turn to nominate", () => {
    const s = getClubStatus(
      input({ club: { ...CLUB, cadence: "ad_hoc" }, memberships: [membership(ME, 1), membership(LOU, 2)] }),
    );
    expect(text(s)).toBe("You pick next");
    expect(isActionStatus(s)).toBe(false);
  });

  it("voting, you haven't voted", () => {
    const s = getClubStatus(input({ nights: [night({ state: "open" })] }));
    expect(text(s)).toBe("Voting — you haven't voted");
    expect(isActionStatus(s)).toBe(true);
  });

  it("voting, you have: names the night's picker", () => {
    const s = getClubStatus(input({ nights: [night({ state: "open" })], viewerVotedOnOpenNight: true }));
    expect(text(s)).toBe("Voting — Lou B. is picking");
    expect(isActionStatus(s)).toBe(false);
  });

  it("voting, you have, and it's your own pick", () => {
    const s = getClubStatus(
      input({ nights: [night({ state: "open", pickerMembershipId: ME })], viewerVotedOnOpenNight: true }),
    );
    expect(text(s)).toBe("Voting — you're picking");
  });

  it("locked, before it's confirmable", () => {
    const s = getClubStatus(input({ nights: [night({ state: "locked", winningFilmId: FILM })] }));
    expect(text(s)).toBe("Thief, locked in");
    expect(isActionStatus(s)).toBe(false);
  });

  it("confirmable: the morning after a locked night", () => {
    const s = getClubStatus(
      input({
        nights: [night({ state: "locked", winningFilmId: FILM, scheduledAt: new Date(NOW.getTime() - 2 * DAY) })],
      }),
    );
    expect(text(s)).toBe("Did you watch Thief?");
    expect(isActionStatus(s)).toBe(true);
  });

  it("confirmable at once when the club confirms manually", () => {
    const s = getClubStatus(
      input({ confirmAt: "manual_only", nights: [night({ state: "locked", winningFilmId: FILM })] }),
    );
    expect(text(s)).toBe("Did you watch Thief?");
  });

  it("rate: you RSVP'd yes to the latest watched night and haven't rated", () => {
    const s = getClubStatus(
      input({ nights: [watched()], viewerOnLatestWatched: { rsvpYes: true, rated: false } }),
    );
    expect(text(s)).toBe("Rate Thief");
    expect(isActionStatus(s)).toBe(true);
  });

  it("no rate line once you've rated, or if you didn't RSVP yes", () => {
    for (const viewerOnLatestWatched of [
      { rsvpYes: true, rated: true },
      { rsvpYes: false, rated: false },
    ]) {
      const s = getClubStatus(input({ nights: [watched()], viewerOnLatestWatched }));
      expect(text(s)).toBe("Lou B. picks next");
      expect(isActionStatus(s)).toBe(false);
    }
  });

  it("otherwise: someone else's draft names its picker, not who picks after them", () => {
    // getNextPicker would name Kit (it counts Lou's draft as picked);
    // the club is waiting on Lou (CLAUDE.md "Whose turn" ruling).
    const s = getClubStatus(input({ nights: [night({ state: "draft" })] }));
    expect(text(s)).toBe("Lou B. picks next");
    expect(isActionStatus(s)).toBe(false);
  });

  it("otherwise, with no night in flight: who the rotation puts next", () => {
    const s = getClubStatus(input());
    expect(text(s)).toBe("Lou B. picks next");
  });

  it("a paused club with nothing in flight has nobody to pick", () => {
    const s = getClubStatus(input({ club: { ...CLUB, pausedAt: new Date(NOW.getTime() - DAY) } }));
    expect(text(s)).toBe("Nobody picks while paused");
    expect(isActionStatus(s)).toBe(false);
  });

  it("a paused club still waits on the draft someone holds", () => {
    const s = getClubStatus(
      input({
        club: { ...CLUB, pausedAt: new Date(NOW.getTime() - DAY) },
        nights: [night({ state: "draft", pickerMembershipId: ME })],
      }),
    );
    expect(text(s)).toBe("Your turn to nominate");
  });
});

// The in-flight stages (draft, open, locked) are one night, so they can't
// overlap. The rating stage is a different night — the latest watched
// one — so it can be true alongside any of them. These pin the order.
describe("getClubStatus: priority when the rating stage overlaps", () => {
  const ratePending = { viewerOnLatestWatched: { rsvpYes: true, rated: false } };

  it("your turn to nominate beats rate", () => {
    const s = getClubStatus(
      input({ ...ratePending, nights: [watched(), night({ state: "draft", pickerMembershipId: ME })] }),
    );
    expect(text(s)).toBe("Your turn to nominate");
  });

  it("voting, you haven't voted, beats rate", () => {
    const s = getClubStatus(input({ ...ratePending, nights: [watched(), night({ state: "open" })] }));
    expect(text(s)).toBe("Voting — you haven't voted");
  });

  it("voting, you have, beats rate: a non-action line hides a pending rating", () => {
    const s = getClubStatus(
      input({ ...ratePending, viewerVotedOnOpenNight: true, nights: [watched(), night({ state: "open" })] }),
    );
    expect(text(s)).toBe("Voting — Lou B. is picking");
    expect(isActionStatus(s)).toBe(false);
  });

  it("locked beats rate: also a non-action line over a pending rating", () => {
    const s = getClubStatus(
      input({ ...ratePending, nights: [watched(), night({ state: "locked", winningFilmId: "f-old" })] }),
    );
    expect(text(s)).toBe("The Thing, locked in");
  });

  it("confirmable beats rate", () => {
    const s = getClubStatus(
      input({
        ...ratePending,
        nights: [
          watched(),
          night({ state: "locked", winningFilmId: "f-old", scheduledAt: new Date(NOW.getTime() - 2 * DAY) }),
        ],
      }),
    );
    expect(text(s)).toBe("Did you watch The Thing?");
  });

  it("rate beats someone else's turn", () => {
    const s = getClubStatus(input({ ...ratePending, nights: [watched(), night({ state: "draft" })] }));
    expect(text(s)).toBe("Rate Thief");
  });
});

describe("night finders (shared with the club page)", () => {
  it("findInFlightNight ignores terminal nights", () => {
    const draft = night({ state: "draft" });
    expect(findInFlightNight([watched(), draft])).toBe(draft);
    expect(findInFlightNight([watched(), night({ state: "cancelled" })])).toBeNull();
  });

  it("findLatestWatchedNight is the most recent by scheduledAt", () => {
    const older = watched({ id: "older", scheduledAt: new Date(NOW.getTime() - 10 * DAY) });
    const newer = watched({ id: "newer" });
    expect(findLatestWatchedNight([newer, older])?.id).toBe("newer");
    expect(findLatestWatchedNight([older, newer])?.id).toBe("newer");
    expect(findLatestWatchedNight([night({ state: "draft" })])).toBeNull();
  });

  it("a locked night is locked or confirmable, never both", () => {
    const future = night({ state: "locked", winningFilmId: FILM });
    expect(findLockedNight([future], "morning_after", CLUB.timezone, NOW)).toBe(future);
    expect(findConfirmableNight([future], "morning_after", CLUB.timezone, NOW)).toBeNull();

    const past = night({ state: "locked", winningFilmId: FILM, scheduledAt: new Date(NOW.getTime() - 2 * DAY) });
    expect(findLockedNight([past], "morning_after", CLUB.timezone, NOW)).toBeNull();
    expect(findConfirmableNight([past], "morning_after", CLUB.timezone, NOW)).toBe(past);
  });

  it("no winner, nothing to confirm or show as locked", () => {
    const noWinner = night({ state: "locked", scheduledAt: new Date(NOW.getTime() - 2 * DAY) });
    expect(findLockedNight([noWinner], "morning_after", CLUB.timezone, NOW)).toBeNull();
    expect(findConfirmableNight([noWinner], "morning_after", CLUB.timezone, NOW)).toBeNull();
  });
});

describe("getDraftToCreate (what the club page inserts lazily)", () => {
  const base = { club: CLUB, memberships: [membership(LOU, 1), membership(ME, 2)], now: NOW };

  it("the next picker, at the club's next occurrence", () => {
    expect(getDraftToCreate({ ...base, nights: [] })).toEqual({ pickerMembershipId: LOU, scheduledAt: NEXT_SAT });
  });

  it("nothing while a night is in flight, for an ad hoc club, or while paused", () => {
    expect(getDraftToCreate({ ...base, nights: [night({ state: "open" })] })).toBeNull();
    expect(getDraftToCreate({ ...base, nights: [], club: { ...CLUB, cadence: "ad_hoc" } })).toBeNull();
    expect(getDraftToCreate({ ...base, nights: [], club: { ...CLUB, pausedAt: NOW } })).toBeNull();
  });
});

describe("next night line", () => {
  it("an in-flight night's own time, in the club's timezone", () => {
    const at = new Date("2026-11-12T00:30:00Z"); // Wed 11 Nov, 7:30pm New York
    const next = getNextNight({ club: CLUB, nights: [night({ state: "open", scheduledAt: at })], now: NOW });
    expect(next).toEqual({ kind: "at", at });
    expect(nextNightText(next, CLUB.timezone)).toBe("Wed 7:30pm");
  });

  it("an in-flight night wins even for an ad hoc or paused club", () => {
    const n = night({ state: "draft" });
    for (const club of [{ ...CLUB, cadence: "ad_hoc" as const }, { ...CLUB, pausedAt: NOW }]) {
      expect(getNextNight({ club, nights: [n], now: NOW })).toEqual({ kind: "at", at: NEXT_SAT });
    }
  });

  it("ad hoc with nothing in flight: No night scheduled", () => {
    const next = getNextNight({ club: { ...CLUB, cadence: "ad_hoc" }, nights: [watched()], now: NOW });
    expect(next).toEqual({ kind: "none" });
    expect(nextNightText(next, CLUB.timezone)).toBe("No night scheduled");
  });

  it("paused with nothing in flight: Paused", () => {
    const next = getNextNight({ club: { ...CLUB, pausedAt: NOW }, nights: [], now: NOW });
    expect(next).toEqual({ kind: "paused" });
    expect(nextNightText(next, CLUB.timezone)).toBe("Paused");
  });

  it("nothing in flight: the computed next occurrence, display only", () => {
    const next = getNextNight({ club: CLUB, nights: [watched()], now: NOW });
    expect(next).toEqual({ kind: "at", at: NEXT_SAT });
    expect(nextNightText(next, CLUB.timezone)).toBe("Sat 8:00pm");
  });
});

describe("formatNightTime", () => {
  it("weekday, hour, minutes and a lowercase am/pm", () => {
    expect(formatNightTime(NEXT_SAT, "America/New_York")).toBe("Sat 8:00pm");
    expect(formatNightTime(new Date("2026-11-08T17:00:00Z"), "America/New_York")).toBe("Sun 12:00pm");
    expect(formatNightTime(new Date("2026-11-08T14:15:00Z"), "America/New_York")).toBe("Sun 9:15am");
  });

  it("is the club's local time, not the server's", () => {
    expect(formatNightTime(NEXT_SAT, "America/Los_Angeles")).toBe("Sat 5:00pm");
    expect(formatNightTime(NEXT_SAT, "Europe/London")).toBe("Sun 1:00am");
  });
});

describe("sortClubCards", () => {
  const card = (name: string, action: boolean, nextAt: Date | null) => ({ name, action, nextAt });

  it("action cards first, then soonest night, then name; no date sorts last", () => {
    const sorted = sortClubCards([
      card("Zed", false, new Date("2026-11-05T00:00:00Z")),
      card("Bee", false, null),
      card("Ant", false, null),
      card("Late action", true, new Date("2026-11-20T00:00:00Z")),
      card("Early action", true, new Date("2026-11-06T00:00:00Z")),
      card("Soon", false, new Date("2026-11-04T23:00:00Z")),
      card("Also soon", false, new Date("2026-11-04T23:00:00Z")),
    ]);
    expect(sorted.map((c) => c.name)).toEqual([
      "Early action",
      "Late action",
      "Also soon",
      "Soon",
      "Zed",
      "Ant",
      "Bee",
    ]);
  });

  it("doesn't mutate its input", () => {
    const cards = [card("B", false, null), card("A", true, null)];
    sortClubCards(cards);
    expect(cards.map((c) => c.name)).toEqual(["B", "A"]);
  });
});
