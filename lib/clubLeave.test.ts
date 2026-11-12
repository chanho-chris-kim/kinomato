import { describe, expect, it } from "vitest";
import { planLeave } from "./clubLeave";

const day = (n: number) => new Date(Date.UTC(2026, 0, n));
const other = (membershipId: string, role: "owner" | "admin" | "member" | "guest", joined: number) => ({
  membershipId,
  role,
  joinedAt: day(joined),
});

describe("planLeave (ruled 2026-11-11; the heir rule is account deletion's)", () => {
  it("a member or an admin just leaves", () => {
    expect(planLeave("member", [other("o", "owner", 1)])).toEqual({ kind: "leave" });
    expect(planLeave("admin", [other("o", "owner", 1), other("m", "member", 2)])).toEqual({ kind: "leave" });
    expect(planLeave("guest", [other("o", "owner", 1)])).toEqual({ kind: "leave" });
  });

  it("the owner with an admin hands over to the earliest-joined admin", () => {
    const others = [other("m1", "member", 2), other("a2", "admin", 6), other("a1", "admin", 4)];
    expect(planLeave("owner", others)).toEqual({ kind: "transfer", heirMembershipId: "a1" });
  });

  it("the owner with only members hands over to the earliest-joined member", () => {
    const others = [other("m2", "member", 5), other("m1", "member", 3), other("g", "guest", 4)];
    expect(planLeave("owner", others)).toEqual({ kind: "transfer", heirMembershipId: "m1" });
  });

  it("the owner beside another active owner just leaves", () => {
    expect(planLeave("owner", [other("o2", "owner", 2), other("m", "member", 3)])).toEqual({ kind: "leave" });
  });

  it("the last active member can't simply leave, whatever their role", () => {
    for (const role of ["owner", "admin", "member", "guest"] as const) {
      expect(planLeave(role, [])).toEqual({ kind: "last_member" });
    }
  });
});
