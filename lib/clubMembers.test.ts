import { describe, expect, it } from "vitest";
import {
  canAddMember,
  FREE_TIER_MEMBER_CAP,
  isDisplayNameTaken,
  MAX_PRE_ADDED_MEMBERS,
} from "./clubMembers";

describe("MAX_PRE_ADDED_MEMBERS", () => {
  it("is one less than the cap — the owner is always the plus-one", () => {
    expect(MAX_PRE_ADDED_MEMBERS).toBe(FREE_TIER_MEMBER_CAP - 1);
  });
});

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

describe("isDisplayNameTaken", () => {
  it("matches an exact existing name", () => {
    expect(isDisplayNameTaken("Dana", ["Chris", "Dana"])).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(isDisplayNameTaken("dana", ["Chris", "Dana"])).toBe(true);
  });

  it("matches ignoring surrounding whitespace", () => {
    expect(isDisplayNameTaken("  Dana  ", ["Chris", "Dana"])).toBe(true);
  });

  it("returns false when the name isn't taken", () => {
    expect(isDisplayNameTaken("Priya", ["Chris", "Dana"])).toBe(false);
  });

  it("returns false against an empty club", () => {
    expect(isDisplayNameTaken("Chris", [])).toBe(false);
  });
});
