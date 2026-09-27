import { describe, expect, it } from "vitest";
import { FREE_TIER_MEMBER_CAP } from "./clubMembers";
import {
  canCreateInvite,
  generateInviteToken,
  parseInviteeName,
  resolveInviteView,
} from "./invites";

describe("generateInviteToken", () => {
  it("is 128 random bits, URL-safe (22 base64url characters)", () => {
    const token = generateInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("maps the given bytes exactly, so nothing is lost or added", () => {
    const bytes = new Uint8Array(16).fill(0xff);
    expect(generateInviteToken(() => bytes)).toBe("_____________________w");
  });

  it("doesn't repeat", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateInviteToken()));
    expect(seen.size).toBe(200);
  });
});

describe("canCreateInvite", () => {
  // Pending invites hold a seat (docs/onboarding-spec.md §7.1), so "4 of 6"
  // means what it says.
  it("counts pending invites against the cap alongside active members", () => {
    expect(canCreateInvite(4, 1)).toBe(true);
    expect(canCreateInvite(4, 2)).toBe(false);
    expect(canCreateInvite(FREE_TIER_MEMBER_CAP, 0)).toBe(false);
    expect(canCreateInvite(1, 0)).toBe(true);
  });
});

describe("parseInviteeName", () => {
  it("splits a composed name back into the name step's two fields", () => {
    expect(parseInviteeName("Marco R.")).toEqual({ firstName: "Marco", lastInitial: "R" });
  });

  it("keeps a multi-word first name whole", () => {
    expect(parseInviteeName("Mary Ann K.")).toEqual({ firstName: "Mary Ann", lastInitial: "K" });
  });

  it("falls back to everything as the first name if it isn't in the composed shape", () => {
    expect(parseInviteeName("Jo")).toEqual({ firstName: "Jo", lastInitial: "" });
  });
});

describe("resolveInviteView", () => {
  const pending = { revokedAt: null, redeemedAt: null };
  const now = new Date("2026-09-27T12:00:00Z");

  it("a missing or revoked invite reads the same — 'replaced' — never 'never existed'", () => {
    expect(resolveInviteView({ invite: null, activeMemberCount: 2, viewer: null })).toBe("replaced");
    expect(
      resolveInviteView({ invite: { ...pending, revokedAt: now }, activeMemberCount: 2, viewer: null }),
    ).toBe("replaced");
  });

  it("an active member of the club sees 'already in', and it isn't consumed — even over used or full", () => {
    const member = { isActiveMember: true };
    expect(resolveInviteView({ invite: pending, activeMemberCount: 2, viewer: member })).toBe(
      "already_member",
    );
    expect(
      resolveInviteView({
        invite: { ...pending, redeemedAt: now },
        activeMemberCount: FREE_TIER_MEMBER_CAP,
        viewer: member,
      }),
    ).toBe("already_member");
  });

  it("a redeemed invite is 'used' for anyone who isn't in the club", () => {
    const redeemed = { ...pending, redeemedAt: now };
    expect(resolveInviteView({ invite: redeemed, activeMemberCount: 2, viewer: null })).toBe("used");
    expect(
      resolveInviteView({ invite: redeemed, activeMemberCount: 2, viewer: { isActiveMember: false } }),
    ).toBe("used");
  });

  it("a full club shows 'full' and leaves the invite unconsumed", () => {
    expect(
      resolveInviteView({ invite: pending, activeMemberCount: FREE_TIER_MEMBER_CAP, viewer: null }),
    ).toBe("full");
  });

  it("valid: signed out gets the landing; signed in as a non-member gets the choice (Ruling B)", () => {
    expect(resolveInviteView({ invite: pending, activeMemberCount: 2, viewer: null })).toBe("valid");
    expect(
      resolveInviteView({ invite: pending, activeMemberCount: 2, viewer: { isActiveMember: false } }),
    ).toBe("signed_in_other");
  });
});
