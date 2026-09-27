// Per-person invites (docs/onboarding-spec.md §7). Pure — no DB calls.
import { FREE_TIER_MEMBER_CAP } from "./clubMembers";

// 128 random bits, base64url. Stored as-is, not hashed: the owner has to
// be able to share the same link again later, and a hash can't be shown
// twice (spec §7.1 step 2).
export function generateInviteToken(
  randomBytes: () => Uint8Array = () => crypto.getRandomValues(new Uint8Array(16)),
): string {
  return Buffer.from(randomBytes()).toString("base64url");
}

// Pending invites hold a seat, so an owner can't hand out more links than
// there are seats (spec §7.1 step 1). Redemption re-checks active members
// only — CLAUDE.md's cap-at-join ruling.
export function canCreateInvite(activeMemberCount: number, pendingInviteCount: number): boolean {
  return activeMemberCount + pendingInviteCount < FREE_TIER_MEMBER_CAP;
}

// The owner types "Marco R."; the name step (/welcome) is prefilled with it
// as its two fields. Only a greeting — the person sets their own name.
export function parseInviteeName(name: string): { firstName: string; lastInitial: string } {
  const match = /^(.+) ([A-Za-z])\.$/.exec(name.trim());
  if (!match) return { firstName: name.trim(), lastInitial: "" };
  return { firstName: match[1], lastInitial: match[2].toUpperCase() };
}

export type InviteView =
  | "replaced" // revoked, regenerated, or never existed — deliberately indistinguishable
  | "already_member" // the viewer is already in; the invite is someone else's seat, untouched
  | "used"
  | "full"
  | "signed_in_other" // Ruling B: signed in as someone who isn't a member
  | "valid"; // signed out: the main path

// Which screen /invite/[token] shows (spec §5.3). Order matters: a dead link
// is dead for everyone; a member is told they're in rather than that it's
// used or full; used beats full because it won't come back.
export function resolveInviteView(input: {
  invite: { revokedAt: Date | null; redeemedAt: Date | null } | null;
  activeMemberCount: number;
  viewer: { isActiveMember: boolean } | null;
}): InviteView {
  const { invite, viewer } = input;
  if (!invite || invite.revokedAt) return "replaced";
  if (viewer?.isActiveMember) return "already_member";
  if (invite.redeemedAt) return "used";
  if (input.activeMemberCount >= FREE_TIER_MEMBER_CAP) return "full";
  return viewer ? "signed_in_other" : "valid";
}
