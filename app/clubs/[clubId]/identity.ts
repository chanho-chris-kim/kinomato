import { activeMembership, requireUser } from "@/app/auth";

// Who is acting in this club: the session's user, through their active
// membership here. Nothing else — the per-club identity cookie and the
// name picker are gone (docs/onboarding-spec.md §8.2), and a stale
// kinomato_identity_* cookie still in a browser is simply never read.
// Pages gate with app/auth.ts's requireClubMember; this is for server
// actions, which are callable directly and so check again, through the
// same gate: signed in, with current consent (§11.1), or sent there.
export async function requireCurrentMembershipId(clubId: string): Promise<string> {
  const user = await requireUser(`/clubs/${clubId}`);
  const membership = await activeMembership(clubId, user.id);
  if (!membership) {
    throw new Error("Not signed in as a member of this club.");
  }
  return membership.id;
}
