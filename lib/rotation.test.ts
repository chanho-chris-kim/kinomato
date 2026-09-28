import { describe, expect, it } from "vitest";
import {
  getNextPicker,
  getRotationOrder,
  getWhoseTurn,
  type RotationMembership,
  type RotationNight,
} from "./rotation";

const CLUB = "club-1";

function membership(
  id: string,
  overrides: Partial<RotationMembership> = {},
): RotationMembership {
  return {
    id,
    userId: `user-${id}`,
    clubId: CLUB,
    joinedAt: new Date("2026-01-01T00:00:00Z"),
    leftAt: null,
    postponedAt: null,
    ...overrides,
  };
}

function night(
  pickerMembershipId: string,
  scheduledAt: string,
  state: RotationNight["state"] = "watched",
): RotationNight {
  return { pickerMembershipId, scheduledAt: new Date(scheduledAt), state };
}

describe("getRotationOrder", () => {
  it("puts a member who has never picked before one who has", () => {
    const a = membership("a");
    const b = membership("b");
    const order = getRotationOrder({
      memberships: [a, b],
      nights: [night("a", "2026-01-10")],
    });
    expect(order.map((m) => m.id)).toEqual(["b", "a"]);
  });

  it("breaks a tie between two members who've never picked by joined_at ASC", () => {
    const a = membership("a", { joinedAt: new Date("2026-01-05") });
    const b = membership("b", { joinedAt: new Date("2026-01-01") });
    const order = getRotationOrder({ memberships: [a, b], nights: [] });
    expect(order.map((m) => m.id)).toEqual(["b", "a"]);
  });

  it("breaks a joined_at tie by id ASC, deterministically", () => {
    const sameInstant = new Date("2026-01-01");
    const a = membership("b-member", { joinedAt: sameInstant });
    const b = membership("a-member", { joinedAt: sameInstant });
    const order = getRotationOrder({ memberships: [a, b], nights: [] });
    expect(order.map((m) => m.id)).toEqual(["a-member", "b-member"]);
  });

  it("orders by last_picked_at ascending once everyone has a pick history", () => {
    const a = membership("a");
    const b = membership("b");
    const c = membership("c");
    const order = getRotationOrder({
      memberships: [a, b, c],
      nights: [
        night("a", "2026-03-01"),
        night("b", "2026-02-01"),
        // c has never picked
      ],
    });
    expect(order.map((m) => m.id)).toEqual(["c", "b", "a"]);
  });

  it("does not let a cancelled night update the picker's position", () => {
    const a = membership("a");
    const b = membership("b");
    const before = getRotationOrder({
      memberships: [a, b],
      nights: [night("a", "2026-01-10")],
    });
    const after = getRotationOrder({
      memberships: [a, b],
      nights: [
        night("a", "2026-01-10"),
        night("a", "2026-01-17", "cancelled"),
      ],
    });
    expect(after.map((m) => m.id)).toEqual(before.map((m) => m.id));
  });

  it("does let an unconfirmed night update the picker's position", () => {
    const a = membership("a");
    const b = membership("b");
    const order = getRotationOrder({
      memberships: [a, b],
      nights: [night("a", "2026-01-10", "unconfirmed")],
    });
    expect(order.map((m) => m.id)).toEqual(["b", "a"]);
  });

  it("puts a postponed member ahead of everyone, even the never-picked", () => {
    const a = membership("a", { postponedAt: new Date("2026-01-05") });
    const b = membership("b");
    const order = getRotationOrder({ memberships: [a, b], nights: [] });
    expect(order.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("orders two postponed members by postponed_at ASC", () => {
    const a = membership("a", { postponedAt: new Date("2026-01-10") });
    const b = membership("b", { postponedAt: new Date("2026-01-05") });
    const order = getRotationOrder({ memberships: [a, b], nights: [] });
    expect(order.map((m) => m.id)).toEqual(["b", "a"]);
  });

  it("excludes members who have left, even if they'd otherwise be next", () => {
    const a = membership("a", { leftAt: new Date("2026-01-02") });
    const b = membership("b");
    const order = getRotationOrder({ memberships: [a, b], nights: [] });
    expect(order.map((m) => m.id)).toEqual(["b"]);
  });

  it("returns an empty order when everyone has left", () => {
    const a = membership("a", { leftAt: new Date("2026-01-02") });
    const order = getRotationOrder({ memberships: [a], nights: [] });
    expect(order).toEqual([]);
  });

  it("carries last_picked_at forward to a rejoined membership of the same user", () => {
    // User x picked recently under their old (left) membership, then left
    // and rejoined. The new membership must not jump the queue.
    const oldMembership = membership("old", {
      userId: "user-x",
      joinedAt: new Date("2026-01-01"),
      leftAt: new Date("2026-02-01"),
    });
    const rejoined = membership("new", {
      userId: "user-x",
      joinedAt: new Date("2026-03-01"),
      leftAt: null,
    });
    const neverPicked = membership("c", { joinedAt: new Date("2026-01-01") });
    const pickedLongAgo = membership("b", { joinedAt: new Date("2026-01-01") });

    const order = getRotationOrder({
      memberships: [oldMembership, rejoined, neverPicked, pickedLongAgo],
      nights: [
        night("old", "2026-01-20"), // x's most recent pick, before leaving
        night("b", "2026-01-05"), // earlier than x's carried-forward pick
      ],
    });

    // c (never picked) first, then b (picked earlier than x), then the
    // rejoined membership last, carrying x's 2026-01-20 pick forward.
    expect(order.map((m) => m.id)).toEqual(["c", "b", "new"]);
  });

  it("never carries a pick across two different users", () => {
    const leaver = membership("old", {
      userId: "user-x",
      joinedAt: new Date("2026-01-01"),
      leftAt: new Date("2026-02-01"),
    });
    const someoneElse = membership("new", {
      userId: "user-y",
      joinedAt: new Date("2026-03-01"),
    });
    const order = getRotationOrder({
      memberships: [leaver, someoneElse],
      nights: [night("old", "2026-01-20")],
    });
    // y never picked: a normal never-picked candidate.
    expect(order.map((m) => m.id)).toEqual(["new"]);
    expect(
      getRotationOrder({ memberships: [leaver, someoneElse], nights: [night("old", "2026-01-20")] }),
    ).toHaveLength(1);
  });

  it("a legacy membership with no user is never matched — not even to another with no user", () => {
    // Only during the step-4 cutover window: guest rows (user_id NULL)
    // still exist until the dev database is wiped. null must not act as a
    // shared identity.
    const oldGuest = membership("old-guest", {
      userId: null,
      joinedAt: new Date("2026-01-01"),
      leftAt: new Date("2026-02-01"),
    });
    const otherGuest = membership("other-guest", {
      userId: null,
      joinedAt: new Date("2026-03-01"),
    });
    const order = getRotationOrder({
      memberships: [oldGuest, otherGuest],
      nights: [night("old-guest", "2026-01-20")],
    });
    expect(order.map((m) => m.id)).toEqual(["other-guest"]);
    // other-guest never picked, so it sorts as never-picked (first) against
    // someone who has.
    const picker = membership("p", { joinedAt: new Date("2026-01-01") });
    const withPicker = getRotationOrder({
      memberships: [oldGuest, otherGuest, picker],
      nights: [night("old-guest", "2026-01-20"), night("p", "2026-01-10")],
    });
    expect(withPicker.map((m) => m.id)).toEqual(["other-guest", "p"]);
  });

  it("lets a new mid-season joiner pick next among the never-picked, by joined_at", () => {
    const veteran = membership("veteran", { joinedAt: new Date("2026-01-01") });
    const newcomer = membership("newcomer", {
      joinedAt: new Date("2026-04-01"),
    });
    const order = getRotationOrder({
      memberships: [veteran, newcomer],
      nights: [night("veteran", "2026-01-10")],
    });
    // veteran has already picked; newcomer has never picked, so newcomer
    // is next even though they joined most recently.
    expect(order.map((m) => m.id)).toEqual(["newcomer", "veteran"]);
  });
});

describe("getNextPicker", () => {
  it("returns the head of the rotation order when the club isn't paused", () => {
    const a = membership("a");
    const b = membership("b");
    const result = getNextPicker({
      memberships: [a, b],
      nights: [night("a", "2026-01-10")],
      clubPausedAt: null,
    });
    expect(result?.id).toBe("b");
  });

  it("returns null when the club is paused, regardless of rotation state", () => {
    const a = membership("a");
    const b = membership("b", { postponedAt: new Date("2026-01-01") });
    const result = getNextPicker({
      memberships: [a, b],
      nights: [],
      clubPausedAt: new Date("2026-01-15"),
    });
    expect(result).toBeNull();
  });

  it("returns null, not a throw, when there are no active members", () => {
    const a = membership("a", { leftAt: new Date("2026-01-02") });
    const result = getNextPicker({
      memberships: [a],
      nights: [],
      clubPausedAt: null,
    });
    expect(result).toBeNull();
  });

  // Confirmation (CLAUDE.md's "did you watch X" flow) transitions a night
  // from open/locked to watched or cancelled. These prove turn advance is
  // a side effect of that transition, not something confirmation code has
  // to compute itself — getNextPicker already treats any non-cancelled
  // state as "picked," so the picker is already not-next the moment the
  // night opens, not only once it's confirmed watched.
  it("already treats an in-progress (open) night as picked, before any confirmation happens", () => {
    const a = membership("a");
    const b = membership("b");
    const result = getNextPicker({
      memberships: [a, b],
      nights: [night("a", "2026-01-10", "open")],
      clubPausedAt: null,
    });
    expect(result?.id).toBe("b");
  });

  it("confirming a night as watched doesn't change who's next — the open state already counted", () => {
    const a = membership("a");
    const b = membership("b");
    const beforeConfirm = getNextPicker({
      memberships: [a, b],
      nights: [night("a", "2026-01-10", "locked")],
      clubPausedAt: null,
    });
    const afterConfirm = getNextPicker({
      memberships: [a, b],
      nights: [night("a", "2026-01-10", "watched")],
      clubPausedAt: null,
    });
    expect(afterConfirm?.id).toBe(beforeConfirm?.id);
    expect(afterConfirm?.id).toBe("b");
  });

  it("confirming a night as cancelled frees the picker to be next again", () => {
    const a = membership("a");
    const b = membership("b");
    const beforeConfirm = getNextPicker({
      memberships: [a, b],
      nights: [night("a", "2026-01-10", "locked")],
      clubPausedAt: null,
    });
    const afterConfirm = getNextPicker({
      memberships: [a, b],
      nights: [night("a", "2026-01-10", "cancelled")],
      clubPausedAt: null,
    });
    expect(beforeConfirm?.id).toBe("b");
    expect(afterConfirm?.id).toBe("a");
  });
});

// "Whose turn" answers "who is the club waiting on?" (CLAUDE.md ruling).
// While a night is in flight that's whoever holds it; getNextPicker
// answers a different question, "who picks next", and counts the in-
// flight night as already picked.
describe("getWhoseTurn", () => {
  const a = membership("a", { joinedAt: new Date("2026-01-01") });
  const b = membership("b", { joinedAt: new Date("2026-01-02") });
  const c = membership("c", { joinedAt: new Date("2026-01-03") });

  it.each(["draft", "open", "locked"] as const)(
    "names the %s night's picker, not who picks after them",
    (state) => {
      const input = {
        memberships: [a, b, c],
        nights: [night("a", "2026-01-10"), night("b", "2026-01-17", state)],
        clubPausedAt: null,
      };
      expect(getNextPicker(input)?.id).toBe("c");
      expect(getWhoseTurn(input)?.id).toBe("b");
    },
  );

  it.each(["watched", "cancelled", "unconfirmed"] as const)(
    "a %s night isn't in flight, so it falls back to getNextPicker",
    (state) => {
      const input = {
        memberships: [a, b, c],
        nights: [night("a", "2026-01-10"), night("b", "2026-01-17", state)],
        clubPausedAt: null,
      };
      expect(getWhoseTurn(input)?.id).toBe(getNextPicker(input)?.id);
    },
  );

  it("with no nights at all, it's getNextPicker", () => {
    const input = { memberships: [a, b, c], nights: [], clubPausedAt: null };
    expect(getWhoseTurn(input)?.id).toBe("a");
  });

  it("with no night in flight, a paused club is waiting on nobody", () => {
    const input = {
      memberships: [a, b, c],
      nights: [night("a", "2026-01-10")],
      clubPausedAt: new Date("2026-01-12"),
    };
    expect(getWhoseTurn(input)).toBeNull();
  });

  it("an in-flight night's picker is still named in a paused club — the night is still waiting on them", () => {
    const input = {
      memberships: [a, b, c],
      nights: [night("b", "2026-01-17", "open")],
      clubPausedAt: new Date("2026-01-12"),
    };
    expect(getWhoseTurn(input)?.id).toBe("b");
  });

  it("names the in-flight picker even if they've since left the club", () => {
    const gone = membership("b", { leftAt: new Date("2026-01-15") });
    const input = {
      memberships: [a, gone, c],
      nights: [night("b", "2026-01-17", "open")],
      clubPausedAt: null,
    };
    expect(getWhoseTurn(input)?.id).toBe("b");
  });
});
