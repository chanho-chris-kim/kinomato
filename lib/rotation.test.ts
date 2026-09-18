import { describe, expect, it } from "vitest";
import {
  getNextPicker,
  getRotationOrder,
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
    identityKey: id,
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

  it("carries last_picked_at forward to a rejoined membership, same identity", () => {
    // "x" picked recently under their old (left) membership, then left
    // and rejoined. The new membership must not jump the queue.
    const oldMembership = membership("old", {
      identityKey: "x",
      joinedAt: new Date("2026-01-01"),
      leftAt: new Date("2026-02-01"),
    });
    const rejoined = membership("new", {
      identityKey: "x",
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

  it("carries last_picked_at forward for a rejoining guest with the same cookie-backed identityKey", () => {
    const oldGuest = membership("old-guest", {
      identityKey: "guest-cookie-abc",
      joinedAt: new Date("2026-01-01"),
      leftAt: new Date("2026-02-01"),
    });
    const rejoinedGuest = membership("new-guest", {
      identityKey: "guest-cookie-abc", // same cookie survives the rejoin
      joinedAt: new Date("2026-03-01"),
      leftAt: null,
    });
    const neverPicked = membership("c", { joinedAt: new Date("2026-01-01") });

    const order = getRotationOrder({
      memberships: [oldGuest, rejoinedGuest, neverPicked],
      nights: [night("old-guest", "2026-01-20")],
    });

    // neverPicked goes first; the rejoined guest still carries their old
    // pick forward instead of jumping the queue as a "new" member.
    expect(order.map((m) => m.id)).toEqual(["c", "new-guest"]);
  });

  it("does not carry last_picked_at forward when a guest's identityKey changes (e.g. cleared cookies)", () => {
    const oldGuest = membership("old-guest", {
      identityKey: "guest-cookie-abc",
      joinedAt: new Date("2026-01-01"),
      leftAt: new Date("2026-02-01"),
    });
    const newGuest = membership("new-guest", {
      identityKey: "guest-cookie-xyz", // different token — can't be matched
      joinedAt: new Date("2026-03-01"),
      leftAt: null,
    });
    const order = getRotationOrder({
      memberships: [oldGuest, newGuest],
      nights: [night("old-guest", "2026-01-20")],
    });
    // No link between the identities, so this is a normal never-picked
    // candidate — genuinely indistinguishable from a brand-new member.
    expect(order.map((m) => m.id)).toEqual(["new-guest"]);
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
