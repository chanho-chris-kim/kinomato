import { describe, expect, it } from "vitest";
import {
  checkDeletionRequestAllowed,
  DELETION_REQUESTS_PER_DAY,
  evaluateDeletionRequest,
  planDeletion,
  type ClubForPlan,
} from "./accountDeletion";

const NOW = new Date("2026-11-07T12:00:00Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);
const hours = (n: number) => new Date(NOW.getTime() + n * 3600_000);
const day = (n: number) => new Date(Date.UTC(2026, 0, n));

const request = (overrides: Partial<Parameters<typeof evaluateDeletionRequest>[0]> = {}) => ({
  attempts: 0,
  expiresAt: minutes(15),
  consumedAt: null,
  cancelledAt: null,
  ...overrides,
});

describe("evaluateDeletionRequest", () => {
  it("is usable while fresh", () => {
    expect(evaluateDeletionRequest(request(), NOW)).toBe("usable");
    expect(evaluateDeletionRequest(request({ attempts: 4 }), NOW)).toBe("usable");
  });

  it("locks after 5 wrong codes", () => {
    expect(evaluateDeletionRequest(request({ attempts: 5 }), NOW)).toBe("locked");
  });

  it("expires at 15 minutes", () => {
    expect(evaluateDeletionRequest(request({ expiresAt: NOW }), NOW)).toBe("expired");
  });

  it("consumed and cancelled are final, ahead of expiry and the lock", () => {
    expect(evaluateDeletionRequest(request({ consumedAt: NOW, attempts: 9, expiresAt: minutes(-1) }), NOW)).toBe(
      "consumed",
    );
    expect(evaluateDeletionRequest(request({ cancelledAt: NOW, expiresAt: minutes(-1) }), NOW)).toBe("cancelled");
  });
});

describe("checkDeletionRequestAllowed", () => {
  it("allows 3 requests in any rolling 24 hours", () => {
    expect(DELETION_REQUESTS_PER_DAY).toBe(3);
    expect(checkDeletionRequestAllowed([], NOW)).toBe(true);
    expect(checkDeletionRequestAllowed([hours(-1), hours(-2)], NOW)).toBe(true);
    expect(checkDeletionRequestAllowed([hours(-1), hours(-2), hours(-3)], NOW)).toBe(false);
    // One of the three has rolled out of the window.
    expect(checkDeletionRequestAllowed([hours(-1), hours(-2), hours(-25)], NOW)).toBe(true);
  });
});

const member = (membershipId: string, role: "owner" | "admin" | "member", joined: number) => ({
  membershipId,
  role,
  joinedAt: day(joined),
});

describe("planDeletion", () => {
  it("a plain member just leaves", () => {
    const clubs: ClubForPlan[] = [
      { clubId: "c", myRole: "member", others: [member("o", "owner", 1), member("m", "member", 3)] },
    ];
    expect(planDeletion(clubs)).toEqual([{ clubId: "c", action: "leave" }]);
  });

  it("an admin leaves too: ownership isn't theirs to pass", () => {
    expect(planDeletion([{ clubId: "c", myRole: "admin", others: [member("o", "owner", 1)] }])).toEqual([
      { clubId: "c", action: "leave" },
    ]);
  });

  it("a sole owner with members passes ownership to the earliest-joined admin first", () => {
    const clubs: ClubForPlan[] = [
      {
        clubId: "c",
        myRole: "owner",
        others: [member("m1", "member", 2), member("a2", "admin", 5), member("a1", "admin", 4)],
      },
    ];
    expect(planDeletion(clubs)).toEqual([{ clubId: "c", action: "transfer", toMembershipId: "a1" }]);
  });

  it("with no admin, to the earliest-joined member", () => {
    const clubs: ClubForPlan[] = [
      { clubId: "c", myRole: "owner", others: [member("m2", "member", 6), member("m1", "member", 3)] },
    ];
    expect(planDeletion(clubs)).toEqual([{ clubId: "c", action: "transfer", toMembershipId: "m1" }]);
  });

  it("breaks a joined_at tie by membership id, so the answer is always the same", () => {
    const clubs: ClubForPlan[] = [
      { clubId: "c", myRole: "owner", others: [member("mb", "member", 3), member("ma", "member", 3)] },
    ];
    expect(planDeletion(clubs)).toEqual([{ clubId: "c", action: "transfer", toMembershipId: "ma" }]);
  });

  it("an owner alongside another active owner just leaves", () => {
    const clubs: ClubForPlan[] = [
      { clubId: "c", myRole: "owner", others: [member("a", "admin", 2), member("o2", "owner", 9)] },
    ];
    expect(planDeletion(clubs)).toEqual([{ clubId: "c", action: "leave" }]);
  });

  it("the last active member deletes the club, whatever their role", () => {
    expect(planDeletion([{ clubId: "c", myRole: "owner", others: [] }])).toEqual([
      { clubId: "c", action: "delete_club" },
    ]);
    expect(planDeletion([{ clubId: "d", myRole: "member", others: [] }])).toEqual([
      { clubId: "d", action: "delete_club" },
    ]);
  });

  it("plans each club on its own, in order", () => {
    const clubs: ClubForPlan[] = [
      { clubId: "alone", myRole: "owner", others: [] },
      { clubId: "mine", myRole: "owner", others: [member("m", "member", 2)] },
      { clubId: "theirs", myRole: "member", others: [member("o", "owner", 1)] },
    ];
    expect(planDeletion(clubs)).toEqual([
      { clubId: "alone", action: "delete_club" },
      { clubId: "mine", action: "transfer", toMembershipId: "m" },
      { clubId: "theirs", action: "leave" },
    ]);
  });
});
