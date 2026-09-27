import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { getDb } from "@/db";
import { clubs, invites, memberships, users } from "@/db/schema";
import { canAddMember } from "@/lib/clubMembers";

// Server-side invite operations (docs/onboarding-spec.md §7). Added in
// rebuild step 3 alongside the old club-wide /join link, which keeps
// working until step 4 removes it.

type Db = ReturnType<typeof getDb>;

export async function activeMemberCount(db: Db, clubId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(memberships)
    .where(and(eq(memberships.clubId, clubId), isNull(memberships.leftAt)));
  return row.n;
}

export async function pendingInviteCount(db: Db, clubId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(invites)
    .where(and(eq(invites.clubId, clubId), isNull(invites.redeemedAt), isNull(invites.revokedAt)));
  return row.n;
}

export async function findActiveMembership(db: Db, clubId: string, userId: string) {
  const [row] = await db
    .select()
    .from(memberships)
    .where(
      and(eq(memberships.clubId, clubId), eq(memberships.userId, userId), isNull(memberships.leftAt)),
    );
  return row ?? null;
}

// The account's name, filling it in from its newest membership if the
// account doesn't have one yet (seeded, claimed, or joined by the old
// club-wide link — all before names lived on users). Null only for a
// brand-new account, which then goes through /welcome.
export async function ensureDisplayName(db: Db, userId: string): Promise<string | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (user?.displayName) return user.displayName;
  const [latest] = await db
    .select({ displayName: memberships.displayName })
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .orderBy(desc(memberships.joinedAt))
    .limit(1);
  if (!latest) return null;
  await db.update(users).set({ displayName: latest.displayName }).where(eq(users.id, userId));
  return latest.displayName;
}

export type RedeemResult =
  | { status: "joined" | "already_member"; clubId: string }
  | { status: "used" | "replaced" | "full"; token: string | null };

// Spec §7.1 step 6, in order, never as one silent step. neon-http has no
// transactions (CLAUDE.md), so the invite claim is the gate: a conditional
// update that only one request can win. If the membership insert then
// fails, the claim is undone so the link still works.
export async function redeemInvite(db: Db, inviteId: string, userId: string): Promise<RedeemResult> {
  const [invite] = await db.select().from(invites).where(eq(invites.id, inviteId));
  if (!invite) return { status: "replaced", token: null };

  // Already in: the invite is someone else's seat, left untouched.
  if (await findActiveMembership(db, invite.clubId, userId)) {
    return { status: "already_member", clubId: invite.clubId };
  }
  if (invite.revokedAt) return { status: "replaced", token: invite.token };
  if (invite.redeemedAt) return { status: "used", token: invite.token };
  // Cap-at-join (CLAUDE.md): active members only. Not consumed if full, so
  // the link works again when a seat opens.
  if (!canAddMember(await activeMemberCount(db, invite.clubId))) {
    return { status: "full", token: invite.token };
  }

  const [claimed] = await db
    .update(invites)
    .set({ redeemedAt: new Date(), redeemedByUserId: userId })
    .where(and(eq(invites.id, inviteId), isNull(invites.redeemedAt), isNull(invites.revokedAt)))
    .returning();
  if (!claimed) {
    const [now] = await db.select().from(invites).where(eq(invites.id, inviteId));
    return { status: now?.revokedAt ? "replaced" : "used", token: invite.token };
  }

  // The account's own name whenever it has one, so the membership never
  // borrows the invitee's name (e.g. Chris joining via Lee's invite under
  // Ruling B's "join as me"). Only a brand-new account gets the owner's
  // typed name as a placeholder, until /welcome replaces it.
  const displayName = await ensureDisplayName(db, userId);
  try {
    // identityKey is the user's id — rotation carry-forward on a rejoin
    // already matches prior memberships by it (CLAUDE.md rotation ruling).
    // memberships.display_name is still required until step 4b: the
    // account's name if it has one, else the name the owner typed, which
    // /welcome then replaces.
    await db.insert(memberships).values({
      clubId: invite.clubId,
      userId,
      identityKey: userId,
      displayName: displayName ?? invite.inviteeName,
      role: "member",
    });
  } catch (error) {
    await db
      .update(invites)
      .set({ redeemedAt: null, redeemedByUserId: null })
      .where(eq(invites.id, inviteId));
    throw error;
  }
  return { status: "joined", clubId: invite.clubId };
}

export async function loadInviteByToken(db: Db, token: string) {
  const [row] = await db
    .select({ invite: invites, club: clubs, inviter: memberships })
    .from(invites)
    .innerJoin(clubs, eq(invites.clubId, clubs.id))
    .innerJoin(memberships, eq(invites.invitedByMembershipId, memberships.id))
    .where(eq(invites.token, token));
  return row ?? null;
}

export function redeemDestination(result: RedeemResult): string {
  switch (result.status) {
    case "joined":
      return `/clubs/${result.clubId}?joined=1`;
    case "already_member":
      return `/clubs/${result.clubId}`;
    default:
      // Back to the landing page, which now shows why (used, replaced, full).
      return result.token ? `/invite/${result.token}` : "/";
  }
}
