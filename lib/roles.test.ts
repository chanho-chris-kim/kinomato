import { describe, expect, it } from "vitest";
import { canChangeRole, canTransferOwnership, roleLabel, type RoleMember } from "./roles";

const CLUB = "club";
const m = (id: string, role: RoleMember["role"], overrides: Partial<RoleMember> = {}): RoleMember => ({
  membershipId: id,
  clubId: CLUB,
  role,
  leftAt: null,
  ...overrides,
});

const owner = m("o", "owner");
const admin = m("a", "admin");
const member = m("m", "member");
const guest = m("g", "guest");
const left = m("l", "member", { leftAt: new Date() });
const otherClub = m("x", "member", { clubId: "elsewhere" });
const leftOwner = m("lo", "owner", { leftAt: new Date() });

describe("canChangeRole (ruled 2026-11-11: only the owner makes or removes admins)", () => {
  it("the owner makes a member or a guest an admin, and removes an admin", () => {
    expect(canChangeRole(owner, member, "admin")).toBe(true);
    expect(canChangeRole(owner, guest, "admin")).toBe(true);
    expect(canChangeRole(owner, admin, "member")).toBe(true);
  });

  it("no-ops are refused: making an admin an admin, removing admin from a member or guest", () => {
    expect(canChangeRole(owner, admin, "admin")).toBe(false);
    expect(canChangeRole(owner, member, "member")).toBe(false);
    expect(canChangeRole(owner, guest, "member")).toBe(false);
  });

  it("never touches the owner: not demoted by remove admin, not made an admin, not even by themselves", () => {
    expect(canChangeRole(owner, owner, "member")).toBe(false);
    expect(canChangeRole(owner, owner, "admin")).toBe(false);
  });

  it("admins, members and guests change nobody's role, their own included", () => {
    for (const actor of [admin, member, guest]) {
      for (const target of [owner, admin, member, guest]) {
        for (const role of ["admin", "member"] as const) {
          expect(canChangeRole(actor, target, role), `${actor.role} → ${target.role} as ${role}`).toBe(false);
        }
      }
    }
  });

  it("only active members of the same club, on either side", () => {
    expect(canChangeRole(owner, left, "admin")).toBe(false);
    expect(canChangeRole(owner, otherClub, "admin")).toBe(false);
    expect(canChangeRole(leftOwner, member, "admin")).toBe(false);
  });
});

describe("canTransferOwnership (owner only, to another active member)", () => {
  it("the owner hands over to an admin, a member or a guest", () => {
    expect(canTransferOwnership(owner, admin)).toBe(true);
    expect(canTransferOwnership(owner, member)).toBe(true);
    expect(canTransferOwnership(owner, guest)).toBe(true);
  });

  it("not to themselves, someone who has left, or someone in another club", () => {
    expect(canTransferOwnership(owner, owner)).toBe(false);
    expect(canTransferOwnership(owner, left)).toBe(false);
    expect(canTransferOwnership(owner, otherClub)).toBe(false);
  });

  it("not to another owner (one owner per club)", () => {
    expect(canTransferOwnership(owner, m("o2", "owner"))).toBe(false);
  });

  it("nobody but the active owner hands over", () => {
    for (const actor of [admin, member, guest, leftOwner]) {
      for (const target of [owner, admin, member, guest]) {
        expect(canTransferOwnership(actor, target), `${actor.membershipId} → ${target.role}`).toBe(false);
      }
    }
  });
});

describe("roleLabel", () => {
  it("words, with the leftover guest shown as a member", () => {
    expect([roleLabel("owner"), roleLabel("admin"), roleLabel("member"), roleLabel("guest")]).toEqual([
      "Owner",
      "Admin",
      "Member",
      "Member",
    ]);
  });
});
