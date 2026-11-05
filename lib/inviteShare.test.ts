import { describe, expect, it } from "vitest";
import { FREE_TIER_MEMBER_CAP } from "./clubMembers";
import { inviteShareText } from "./inviteShare";

const base = {
  invite: { revokedAt: null, redeemedAt: null },
  activeMemberCount: 2,
  inviterName: "Chris K.",
  clubName: "Saturday Club",
  scheduleLine: "Weekly, Saturdays at 8pm · In person",
};

describe("inviteShareText (an invite link's preview text)", () => {
  it("a valid invite: who invited you, to which club, and when it meets", () => {
    expect(inviteShareText(base)).toEqual({
      title: "Chris K. invited you to Saturday Club",
      description: "Join Saturday Club on Kinomato. Weekly, Saturdays at 8pm · In person.",
    });
  });

  it("never says anything about the members", () => {
    const text = inviteShareText({ ...base, activeMemberCount: 5 })!;
    expect(`${text.title} ${text.description}`).not.toMatch(/\d+ (members?|people|seats?)|of 6/i);
  });

  it("an unknown token (never existed, or regenerated): generic, nothing about any club", () => {
    expect(inviteShareText({ ...base, invite: null })).toBeNull();
  });

  it("a revoked invite: generic", () => {
    expect(inviteShareText({ ...base, invite: { revokedAt: new Date(), redeemedAt: null } })).toBeNull();
  });

  it("a used invite: generic", () => {
    expect(inviteShareText({ ...base, invite: { revokedAt: null, redeemedAt: new Date() } })).toBeNull();
  });

  it("a full club: generic", () => {
    expect(inviteShareText({ ...base, activeMemberCount: FREE_TIER_MEMBER_CAP })).toBeNull();
  });

  it("an inviter with no name yet: generic rather than an invented one", () => {
    expect(inviteShareText({ ...base, inviterName: null })).toBeNull();
  });

  it("a schedule line that already ends in a full stop doesn't get a second", () => {
    expect(inviteShareText({ ...base, scheduleLine: "Ad hoc." })!.description).toBe(
      "Join Saturday Club on Kinomato. Ad hoc.",
    );
  });
});
