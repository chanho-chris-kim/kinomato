import { cookies } from "next/headers";

// No auth in v0: identity is a membership id in a per-club cookie, set by
// picking a name from the club's member list. Shared between the club
// home page and the watchlist page — every route under /clubs/[clubId]
// uses the same cookie.
export function identityCookieName(clubId: string) {
  return `kinomato_identity_${clubId}`;
}

export async function getIdentityMembershipId(clubId: string): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(identityCookieName(clubId))?.value ?? null;
}

export async function requireCurrentMembershipId(clubId: string): Promise<string> {
  const membershipId = await getIdentityMembershipId(clubId);
  if (!membershipId) {
    throw new Error("No identity set for this club — pick a name first.");
  }
  return membershipId;
}
