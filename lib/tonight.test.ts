import { describe, expect, it } from "vitest";
import {
  canSayIWasThere,
  isVisiblyRevealed,
  startsIn,
  stepLine,
  voteCountsVisible,
  weekStage,
  wonText,
} from "./tonight";

const NOW = new Date("2026-11-25T17:00:00Z");
const H = 3600_000;
const later = new Date(NOW.getTime() + 30 * H);
const earlier = new Date(NOW.getTime() - 2 * H);

// The week bar (ruled 2026-11-25): Nominate → Vote → Locked → Watch → Rate.
describe("weekStage", () => {
  const base = { paused: false, inFlight: null, ratingsOpen: false, now: NOW };

  it("a draft is Nominate, an open night Vote", () => {
    expect(weekStage({ ...base, inFlight: { state: "draft", scheduledAt: later } })).toBe("nominate");
    expect(weekStage({ ...base, inFlight: { state: "open", scheduledAt: later } })).toBe("vote");
  });

  it("a locked night is Locked before it starts and Watch from its start until confirmed", () => {
    expect(weekStage({ ...base, inFlight: { state: "locked", scheduledAt: later } })).toBe("locked");
    expect(weekStage({ ...base, inFlight: { state: "locked", scheduledAt: NOW } })).toBe("watch");
    expect(weekStage({ ...base, inFlight: { state: "locked", scheduledAt: earlier } })).toBe("watch");
  });

  it("a watched night with ratings open is Rate, ahead of the next night's draft", () => {
    expect(weekStage({ ...base, ratingsOpen: true })).toBe("rate");
    expect(weekStage({ ...base, ratingsOpen: true, inFlight: { state: "draft", scheduledAt: later } })).toBe("rate");
  });

  it("once the next night opens voting, the week has moved on", () => {
    expect(weekStage({ ...base, ratingsOpen: true, inFlight: { state: "open", scheduledAt: later } })).toBe("vote");
    expect(weekStage({ ...base, ratingsOpen: true, inFlight: { state: "locked", scheduledAt: later } })).toBe("locked");
  });

  it("no night, or a paused club: no bar", () => {
    expect(weekStage(base)).toBeNull();
    expect(weekStage({ ...base, paused: true, inFlight: { state: "open", scheduledAt: later } })).toBeNull();
    expect(weekStage({ ...base, paused: true, ratingsOpen: true })).toBeNull();
  });
});

describe("stepLine", () => {
  it("names the step and what comes after", () => {
    expect(stepLine("nominate")).toBe("Step 1 of 5 · Nominate · then Vote, Locked, Watch, Rate");
    expect(stepLine("vote")).toBe("Step 2 of 5 · Vote · then Locked, Watch, Rate");
    expect(stepLine("rate")).toBe("Step 5 of 5 · Rate");
  });
});

// "Show vote counts while voting is open" (ruled 2026-11-25).
describe("voteCountsVisible", () => {
  it("an open night shows counts only when the setting is on", () => {
    expect(voteCountsVisible("open", false)).toBe(false);
    expect(voteCountsVisible("open", true)).toBe(true);
  });
  it("once voting closes, the result shows either way", () => {
    for (const state of ["locked", "watched", "cancelled", "unconfirmed"] as const) {
      expect(voteCountsVisible(state, false)).toBe(true);
    }
  });
  it("a draft has no votes to show", () => {
    expect(voteCountsVisible("draft", true)).toBe(false);
  });
});

describe("isVisiblyRevealed", () => {
  it("every yes-RSVP has rated and at least one rating exists", () => {
    expect(isVisiblyRevealed(["a", "b"], ["a", "b"])).toBe(true);
    expect(isVisiblyRevealed(["a", "b"], ["a"])).toBe(false);
  });
  it("nobody RSVP'd yes and nobody has rated: nothing has been shown", () => {
    expect(isVisiblyRevealed([], [])).toBe(false);
  });
  it("a rating with nobody to wait on is shown", () => {
    expect(isVisiblyRevealed([], ["c"])).toBe(true);
  });
});

// "I was there" (ruled 2026-11-24, built 2026-11-25).
describe("canSayIWasThere", () => {
  const ok = { nightState: "watched" as const, myRsvp: null, revealed: false };
  it("a watched night, not revealed, with no answer from you", () => {
    expect(canSayIWasThere(ok)).toBe(true);
  });
  it("never after the reveal", () => {
    expect(canSayIWasThere({ ...ok, revealed: true })).toBe(false);
  });
  it("not if you said no, and nothing to do if you already said yes", () => {
    expect(canSayIWasThere({ ...ok, myRsvp: "no" })).toBe(false);
    expect(canSayIWasThere({ ...ok, myRsvp: "yes" })).toBe(false);
  });
  it("only a watched night", () => {
    for (const nightState of ["draft", "open", "locked", "cancelled", "unconfirmed"] as const) {
      expect(canSayIWasThere({ ...ok, nightState })).toBe(false);
    }
  });
});

describe("wonText", () => {
  it("the winner's count against the runner-up's", () => {
    expect(wonText([{ count: 3, winner: true }, { count: 1, winner: false }, { count: 0, winner: false }])).toBe("Won 3 to 1");
    expect(wonText([{ count: 2, winner: true }, { count: 2, winner: false }])).toBe("Won 2 to 2");
  });
  it("one nominee: its count alone", () => {
    expect(wonText([{ count: 1, winner: true }])).toBe("Won with 1 vote");
    expect(wonText([{ count: 4, winner: true }])).toBe("Won with 4 votes");
  });
  it("nobody voted: null, so the page says the first choice won", () => {
    expect(wonText([{ count: 0, winner: true }, { count: 0, winner: false }])).toBeNull();
    expect(wonText([])).toBeNull();
  });
});

describe("startsIn", () => {
  it("days and hours, then hours and minutes, then minutes", () => {
    expect(startsIn(NOW, new Date(NOW.getTime() + 52 * H + 20 * 60_000))).toBe("Starts in 2 days, 4 hours");
    expect(startsIn(NOW, new Date(NOW.getTime() + 24 * H))).toBe("Starts in 1 day");
    expect(startsIn(NOW, new Date(NOW.getTime() + 5 * H + 30 * 60_000))).toBe("Starts in 5 hours, 30 minutes");
    expect(startsIn(NOW, new Date(NOW.getTime() + 1 * H))).toBe("Starts in 1 hour");
    expect(startsIn(NOW, new Date(NOW.getTime() + 45 * 60_000))).toBe("Starts in 45 minutes");
  });
  it("under a minute, or already started: null", () => {
    expect(startsIn(NOW, new Date(NOW.getTime() + 30_000))).toBeNull();
    expect(startsIn(NOW, earlier)).toBeNull();
  });
});
