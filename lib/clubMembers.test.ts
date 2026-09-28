import { describe, expect, it } from "vitest";
import {
  canAddMember,
  FREE_TIER_MEMBER_CAP,
} from "./clubMembers";

describe("canAddMember", () => {
  it("allows joining below the free-tier cap", () => {
    expect(canAddMember(0)).toBe(true);
    expect(canAddMember(FREE_TIER_MEMBER_CAP - 1)).toBe(true);
  });

  it("refuses joining once the club is at the cap", () => {
    expect(canAddMember(FREE_TIER_MEMBER_CAP)).toBe(false);
  });

  it("refuses joining if the count is somehow already over the cap", () => {
    expect(canAddMember(FREE_TIER_MEMBER_CAP + 1)).toBe(false);
  });
});
