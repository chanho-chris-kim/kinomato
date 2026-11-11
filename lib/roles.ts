// Who may change whose role in a club (docs/onboarding-spec.md §5.10,
// ruled 2026-11-11). Pure. The server actions re-check with these on
// every call (app/clubs/[clubId]/actions.ts), and the Members tab shows
// controls only where these say yes.
//
// - Only the owner makes or removes admins, and transfers ownership. One
//   owner per club.
// - Admins and members change nobody's role, their own included.
// - The owner's own role never changes here: not through "remove admin",
//   not to admin. It only moves by a transfer, after which they're an
//   admin.
// - The leftover `guest` value counts as a member: "make admin" is its
//   only promotion.

export type Role = "owner" | "admin" | "member" | "guest";

export interface RoleMember {
  membershipId: string;
  clubId: string;
  role: Role;
  leftAt: Date | null;
}

const isActiveOwner = (actor: RoleMember) => actor.role === "owner" && actor.leftAt === null;

// Someone else, still active, in the actor's club.
const isOtherActiveMember = (actor: RoleMember, target: RoleMember) =>
  target.clubId === actor.clubId && target.leftAt === null && target.membershipId !== actor.membershipId;

export function canChangeRole(actor: RoleMember, target: RoleMember, newRole: "admin" | "member"): boolean {
  if (!isActiveOwner(actor) || !isOtherActiveMember(actor, target)) return false;
  if (target.role === "owner") return false;
  return newRole === "admin" ? target.role === "member" || target.role === "guest" : target.role === "admin";
}

export function canTransferOwnership(actor: RoleMember, target: RoleMember): boolean {
  return isActiveOwner(actor) && isOtherActiveMember(actor, target) && target.role !== "owner";
}

export function roleLabel(role: Role): string {
  return role === "owner" ? "Owner" : role === "admin" ? "Admin" : "Member";
}
