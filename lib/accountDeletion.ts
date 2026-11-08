// Delete account (docs/onboarding-spec.md §11.4; launch foundations (f)).
// Pure. A 6-digit code to the account's own address confirms it, held in
// its own table that sign-in never reads; then each club the person is in
// is planned: leave it, pass its ownership on, or delete it outright.

import { CODE_MAX_ATTEMPTS, SIGN_IN_DURATION_MS } from "./authCredentials";

export const DELETION_CODE_DURATION_MS = SIGN_IN_DURATION_MS; // 15 minutes
export const DELETION_REQUESTS_PER_DAY = 3;

export type DeletionRequestState = "usable" | "expired" | "locked" | "consumed" | "cancelled";

// Consumed and cancelled are final; then expiry; then the 5-wrong-codes
// lock, the same limit as sign-in codes (§4.3).
export function evaluateDeletionRequest(
  request: { attempts: number; expiresAt: Date; consumedAt: Date | null; cancelledAt: Date | null },
  now: Date,
): DeletionRequestState {
  if (request.consumedAt !== null) return "consumed";
  if (request.cancelledAt !== null) return "cancelled";
  if (request.expiresAt.getTime() <= now.getTime()) return "expired";
  if (request.attempts >= CODE_MAX_ATTEMPTS) return "locked";
  return "usable";
}

// At most 3 code requests per person in any rolling 24 hours.
export function checkDeletionRequestAllowed(recentRequests: Date[], now: Date): boolean {
  const dayAgo = now.getTime() - 24 * 3600_000;
  return recentRequests.filter((d) => d.getTime() > dayAgo).length < DELETION_REQUESTS_PER_DAY;
}

type Role = "owner" | "admin" | "member" | "guest";

export interface ClubForPlan {
  clubId: string;
  myRole: Role;
  // The club's other *active* members. Pending invites don't count.
  others: { membershipId: string; role: Role; joinedAt: Date }[];
}

export type ClubPlan =
  | { clubId: string; action: "leave" }
  | { clubId: string; action: "transfer"; toMembershipId: string }
  | { clubId: string; action: "delete_club" };

const earliest = (members: ClubForPlan["others"]) =>
  [...members].sort(
    (a, b) => a.joinedAt.getTime() - b.joinedAt.getTime() || a.membershipId.localeCompare(b.membershipId),
  )[0];

// Ruled 2026-11-07 (§11.4), per club:
// - the last active member: the club is deleted, everything in it;
// - the owner, with no other active owner: ownership passes to the
//   earliest-joined admin, else the earliest-joined member (membership id
//   breaks a tie, so it's always the same person);
// - anyone else: they leave (marked left by the anonymisation).
export function planDeletion(clubs: ClubForPlan[]): ClubPlan[] {
  return clubs.map(({ clubId, myRole, others }) => {
    if (others.length === 0) return { clubId, action: "delete_club" };
    if (myRole !== "owner" || others.some((o) => o.role === "owner")) return { clubId, action: "leave" };
    const admins = others.filter((o) => o.role === "admin");
    const heir = earliest(admins.length ? admins : others);
    return { clubId, action: "transfer", toMembershipId: heir.membershipId };
  });
}
