import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { memberships } from "@/db/schema";
import { getSessionUserId } from "@/app/session";

// Guest identity is unchanged from v0: a membership id in a per-club
// cookie, set by picking a name from the club's member list. Shared
// between every route under /clubs/[clubId].
export function identityCookieName(clubId: string) {
  return `kinomato_identity_${clubId}`;
}

// Fallback order (CLAUDE.md, load-bearing): the per-club cookie first
// — cheap, no DB read, and what every guest always has. If it's
// missing, fall back to the site-wide session (app/session.ts): a
// verified member's identity survives a cleared cookie or a new device
// not because anything is unclearable, but because users.email is a
// durable anchor a fresh magic link always re-finds. A guest with no
// session has no fallback and is genuinely signed out — same as today.
export async function getIdentityMembershipId(clubId: string): Promise<string | null> {
  const cookieStore = await cookies();
  const perClub = cookieStore.get(identityCookieName(clubId))?.value;
  if (perClub) return perClub;

  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const userId = await getSessionUserId(db);
  if (!userId) return null;

  const [membership] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.clubId, clubId), eq(memberships.userId, userId)));
  return membership?.id ?? null;
}

export async function requireCurrentMembershipId(clubId: string): Promise<string> {
  const membershipId = await getIdentityMembershipId(clubId);
  if (!membershipId) {
    throw new Error("No identity set for this club — pick a name first.");
  }
  return membershipId;
}
