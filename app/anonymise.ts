import { and, eq, inArray, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { getDb } from "@/db";
import { deleteEmailChangesOf } from "@/app/emailChange";
import { deleteWatchlistOf } from "@/app/watchlistRead";
import {
  constraints,
  dataLicensingConsents,
  invites,
  magicLinks,
  memberships,
  ratings,
  ratingTags,
  sessions,
  users,
} from "@/db/schema";

type Db = ReturnType<typeof getDb>;

// The name an anonymised account shows everywhere it's still referenced:
// a past pick, a turn it was holding, a kept rating.
export const FORMER_MEMBER = "Former member";

// Releases the address (§11.4): users.email is unique, so the old address
// has to go for a fresh sign-up with it to be possible. `.invalid` is
// reserved (RFC 2606) and can never receive mail.
export function tombstoneEmail(userId: string): string {
  return `deleted-${userId}@deleted.kinomato.invalid`;
}

// docs/onboarding-spec.md §11.4, exactly, in one place: under 13 on
// /consent, and Delete account (app/accountDeletion.ts). The users row
// stays, because attribution, rotation and History reference its
// memberships. Its callers do the gating (Delete account's code by email,
// ownership transfers and club deletion are its own, not this function's). One db.batch, so it
// lands whole or not at all (neon-http has no transactions).
export async function anonymiseAccount(db: Db, userId: string, now = new Date()): Promise<void> {
  const statements = await anonymisationStatements(db, userId, now);
  if (statements.length) await db.batch(statements as [BatchItem<"pg">, ...BatchItem<"pg">[]]);
}

// The same, as statements for a caller's own db.batch: Delete account
// (app/accountDeletion.ts) runs them after its ownership transfers and
// club deletions, all in one batch. Empty if there's no such account.
export async function anonymisationStatements(db: Db, userId: string, now: Date): Promise<BatchItem<"pg">[]> {
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  if (!user) return [];
  const membershipIds = (
    await db.select({ id: memberships.id }).from(memberships).where(eq(memberships.userId, userId))
  ).map((m) => m.id);
  const ratingIds = membershipIds.length
    ? (
        await db.select({ id: ratings.id }).from(ratings).where(inArray(ratings.membershipId, membershipIds))
      ).map((r) => r.id)
    : [];

  const statements: BatchItem<"pg">[] = [];
  if (ratingIds.length) {
    // Ratings: scores kept; hot takes and rating tags removed.
    statements.push(db.delete(ratingTags).where(inArray(ratingTags.ratingId, ratingIds)));
    statements.push(db.update(ratings).set({ hotTake: null }).where(inArray(ratings.id, ratingIds)));
  }
  if (membershipIds.length) {
    // Hard limits and preferences: deleted.
    statements.push(db.delete(constraints).where(inArray(constraints.membershipId, membershipIds)));
    // Pending invites they created: revoked, the invitee's name cleared
    // (the column is NOT NULL, so cleared is the empty string).
    statements.push(
      db
        .update(invites)
        .set({ revokedAt: now, inviteeName: "" })
        .where(
          and(
            inArray(invites.invitedByMembershipId, membershipIds),
            isNull(invites.redeemedAt),
            isNull(invites.revokedAt),
          ),
        ),
    );
  }
  statements.push(
    // Watchlist: deleted.
    deleteWatchlistOf(db, userId),
    // Memberships: marked left, kept.
    db
      .update(memberships)
      .set({ leftAt: now })
      .where(and(eq(memberships.userId, userId), isNull(memberships.leftAt))),
    // Sessions, sign-in codes, email changes: deleted.
    db.delete(sessions).where(eq(sessions.userId, userId)),
    db.delete(magicLinks).where(eq(magicLinks.email, user.email)),
    deleteEmailChangesOf(db, userId),
    // An open data-sharing opt-in: withdrawn (§11.4), so nothing it left
    // behind feeds a future aggregate. The row is kept, as every
    // withdrawal is.
    db
      .update(dataLicensingConsents)
      .set({ withdrawnAt: now })
      .where(and(eq(dataLicensingConsents.userId, userId), isNull(dataLicensingConsents.withdrawnAt))),
    // Name: "Former member". Email: released.
    db.update(users).set({ displayName: FORMER_MEMBER, email: tombstoneEmail(userId) }).where(eq(users.id, userId)),
  );
  // Votes, vetoes, nominations, picks: kept, untouched.
  return statements;
}
