import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { memberships } from "@/db/schema";
import { getSessionUserId } from "@/app/session";

// Who is acting in this club: the session's user, through their active
// membership here. Nothing else — the per-club identity cookie and the
// name picker are gone (docs/onboarding-spec.md §8.2), and a stale
// kinomato_identity_* cookie still in a browser is simply never read.
// Pages gate with app/auth.ts's requireClubMember; this is for server
// actions, which are callable directly and so check again.
export async function getIdentityMembershipId(clubId: string): Promise<string | null> {
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const userId = await getSessionUserId(db);
  if (!userId) return null;
  const [membership] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.clubId, clubId), eq(memberships.userId, userId), isNull(memberships.leftAt)));
  return membership?.id ?? null;
}

export async function requireCurrentMembershipId(clubId: string): Promise<string> {
  const membershipId = await getIdentityMembershipId(clubId);
  if (!membershipId) {
    throw new Error("Not signed in as a member of this club.");
  }
  return membershipId;
}
