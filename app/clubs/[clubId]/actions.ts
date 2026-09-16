"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { nominations, rsvps, votes } from "@/db/schema";

// No auth in v0: identity is a membership id in a per-club cookie, set by
// picking a name from the club's member list. Nothing here trusts a
// client-supplied membership id — every action reads it back off the
// cookie itself.
function identityCookieName(clubId: string) {
  return `kinomato_identity_${clubId}`;
}

async function requireCurrentMembershipId(clubId: string): Promise<string> {
  const cookieStore = await cookies();
  const membershipId = cookieStore.get(identityCookieName(clubId))?.value;
  if (!membershipId) {
    throw new Error("No identity set for this club — pick a name first.");
  }
  return membershipId;
}

export async function pickIdentity(clubId: string, membershipId: string) {
  const cookieStore = await cookies();
  cookieStore.set(identityCookieName(clubId), membershipId, {
    httpOnly: true,
    sameSite: "lax",
    path: `/clubs/${clubId}`,
  });
  revalidatePath(`/clubs/${clubId}`);
}

export async function clearIdentity(clubId: string) {
  const cookieStore = await cookies();
  cookieStore.delete({ name: identityCookieName(clubId), path: `/clubs/${clubId}` });
  revalidatePath(`/clubs/${clubId}`);
}

// One vote per person per night, movable (v1 §1.1 stage 7) — a night has
// several nominations, so "movable" means deleting any existing vote(s)
// this member has among this night's other nominations before inserting
// the new one. drizzle-orm/neon-http has no db.transaction() (it throws
// "No transactions support in neon-http driver" — HTTP is one query per
// round-trip, no session to hold open). db.batch() is the neon-http
// replacement: both statements ride in one HTTP call as a single
// non-interactive Postgres transaction, atomic the same way — it's a
// fit here specifically because the insert doesn't need to read the
// delete's result, unlike a generic transaction callback.
export async function castVote(clubId: string, nominationId: string) {
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const membershipId = await requireCurrentMembershipId(clubId);

  const [nomination] = await db
    .select({ nightId: nominations.nightId })
    .from(nominations)
    .where(eq(nominations.id, nominationId));
  if (!nomination) throw new Error("Nomination not found.");

  const sameNightNominations = await db
    .select({ id: nominations.id })
    .from(nominations)
    .where(eq(nominations.nightId, nomination.nightId));
  const sameNightIds = sameNightNominations.map((n) => n.id);

  await db.batch([
    db
      .delete(votes)
      .where(
        and(
          eq(votes.membershipId, membershipId),
          inArray(votes.nominationId, sameNightIds),
        ),
      ),
    db.insert(votes).values({ nominationId, membershipId }),
  ]);

  revalidatePath(`/clubs/${clubId}`);
}

export async function setRsvp(
  clubId: string,
  nightId: string,
  status: "yes" | "no",
) {
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const membershipId = await requireCurrentMembershipId(clubId);

  await db
    .insert(rsvps)
    .values({ nightId, membershipId, status })
    .onConflictDoUpdate({
      target: [rsvps.nightId, rsvps.membershipId],
      set: { status, updatedAt: new Date() },
    });

  revalidatePath(`/clubs/${clubId}`);
}
