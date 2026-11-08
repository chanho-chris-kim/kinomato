import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { getDb } from "@/db";
import {
  accountDeletionRequests,
  clubs,
  constraints,
  invites,
  magicLinks,
  memberships,
  nights,
  nominations,
  ratings,
  ratingTags,
  rsvps,
  seasons,
  tags,
  users,
} from "@/db/schema";
import { anonymisationStatements } from "@/app/anonymise";
import { deleteVotesAndVetoesOfClubs } from "@/app/clubs/[clubId]/historyRead";
import {
  checkDeletionRequestAllowed,
  type ClubPlan,
  DELETION_CODE_DURATION_MS,
  evaluateDeletionRequest,
  planDeletion,
} from "@/lib/accountDeletion";
import { CODE_MAX_ATTEMPTS, codeMatches, generateSignInCode, getAuthSecret, hashCode } from "@/lib/authCredentials";
import { sendAccountDeletedReceipt, sendAccountDeletionCode } from "@/lib/email";

// Delete account (docs/onboarding-spec.md §11.4; launch foundations (f)).
// The only code that touches account_deletion_requests
// (lib/accountDeletionAccess.test.ts): sign-in never reads it, so a
// deletion code can't sign anyone in. A code to the account's own address
// confirms; then one db.batch passes on ownership, deletes the clubs the
// person was the last member of, and anonymises the account
// (app/anonymise.ts).

type Db = ReturnType<typeof getDb>;
type User = { id: string; email: string };
export type DeletionResult = { ok: true } | { ok: false; error: string };

export type ClubOutcome =
  | { clubId: string; clubName: string; action: "leave" }
  | { clubId: string; clubName: string; action: "transfer"; toMembershipId: string; newOwnerName: string }
  | { clubId: string; clubName: string; action: "delete_club" };

// What deleting would do to each club the person is active in, for the
// confirmation screen and for the delete itself (lib/accountDeletion.ts
// planDeletion). Other members' roles and join dates only; the new
// owner's name is the one name shown, to the person handing the club on.
export async function deletionPlanFor(db: Db, userId: string): Promise<ClubOutcome[]> {
  const mine = await db
    .select({ clubId: memberships.clubId, role: memberships.role, clubName: clubs.name })
    .from(memberships)
    .innerJoin(clubs, eq(memberships.clubId, clubs.id))
    .where(and(eq(memberships.userId, userId), isNull(memberships.leftAt)));
  if (mine.length === 0) return [];
  const clubIds = mine.map((m) => m.clubId);
  const everyone = await db
    .select({
      clubId: memberships.clubId,
      membershipId: memberships.id,
      userId: memberships.userId,
      role: memberships.role,
      joinedAt: memberships.joinedAt,
      name: users.displayName,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(and(inArray(memberships.clubId, clubIds), isNull(memberships.leftAt)));
  const others = (clubId: string) => everyone.filter((m) => m.clubId === clubId && m.userId !== userId);

  const plans = planDeletion(mine.map((m) => ({ clubId: m.clubId, myRole: m.role, others: others(m.clubId) })));
  return plans
    .map((plan: ClubPlan): ClubOutcome => {
      const clubName = mine.find((m) => m.clubId === plan.clubId)!.clubName;
      if (plan.action !== "transfer") return { ...plan, clubName };
      const heir = everyone.find((m) => m.membershipId === plan.toMembershipId)!;
      return { ...plan, clubName, newOwnerName: heir.name ?? "Unnamed member" };
    })
    .sort((a, b) => a.clubName.localeCompare(b.clubName));
}

async function newestOpen(db: Db, userId: string) {
  const [row] = await db
    .select()
    .from(accountDeletionRequests)
    .where(
      and(
        eq(accountDeletionRequests.userId, userId),
        isNull(accountDeletionRequests.consumedAt),
        isNull(accountDeletionRequests.cancelledAt),
      ),
    )
    .orderBy(desc(accountDeletionRequests.createdAt))
    .limit(1);
  return row ?? null;
}

// The request in progress, for /settings/delete-account: its state only.
export async function pendingDeletion(db: Db, userId: string, now: Date) {
  const row = await newestOpen(db, userId);
  return row ? evaluateDeletionRequest(row, now) : null;
}

// Send a code to the account's own address. At most 3 a day; a newer
// request cancels an older one.
export async function requestAccountDeletion(db: Db, user: User, now: Date): Promise<DeletionResult> {
  const dayAgo = new Date(now.getTime() - 24 * 3600_000);
  const recent = await db
    .select({ createdAt: accountDeletionRequests.createdAt })
    .from(accountDeletionRequests)
    .where(and(eq(accountDeletionRequests.userId, user.id), gt(accountDeletionRequests.createdAt, dayAgo)));
  if (!checkDeletionRequestAllowed(recent.map((r) => r.createdAt), now)) {
    return { ok: false, error: "You can ask for a deletion code 3 times a day. Try again tomorrow." };
  }
  const code = generateSignInCode();
  await db.batch([
    db
      .update(accountDeletionRequests)
      .set({ cancelledAt: now })
      .where(
        and(
          eq(accountDeletionRequests.userId, user.id),
          isNull(accountDeletionRequests.consumedAt),
          isNull(accountDeletionRequests.cancelledAt),
        ),
      ),
    db.insert(accountDeletionRequests).values({
      userId: user.id,
      codeHash: hashCode(code, getAuthSecret()),
      expiresAt: new Date(now.getTime() + DELETION_CODE_DURATION_MS),
      createdAt: now,
    }),
  ]);
  await sendAccountDeletionCode(user.email, code);
  return { ok: true };
}

export async function cancelAccountDeletion(db: Db, userId: string, now: Date): Promise<void> {
  await db
    .update(accountDeletionRequests)
    .set({ cancelledAt: now })
    .where(
      and(
        eq(accountDeletionRequests.userId, userId),
        isNull(accountDeletionRequests.consumedAt),
        isNull(accountDeletionRequests.cancelledAt),
      ),
    );
}

// Every row of a club with no active member left, in an order the foreign
// keys allow (§11.4, ruled 2026-11-07). Votes and vetoes go through the
// history-read module, the only code that touches them. A sign-in code
// started from one of the club's invites loses only its invite link:
// signing in still works, it just joins nothing.
function clubDeletionStatements(db: Db, clubIds: string[]): BatchItem<"pg">[] {
  const clubNights = db.select({ id: nights.id }).from(nights).where(inArray(nights.clubId, clubIds));
  const clubRatings = db.select({ id: ratings.id }).from(ratings).where(inArray(ratings.nightId, clubNights));
  const clubMemberships = db
    .select({ id: memberships.id })
    .from(memberships)
    .where(inArray(memberships.clubId, clubIds));
  const clubInvites = db.select({ id: invites.id }).from(invites).where(inArray(invites.clubId, clubIds));
  return [
    ...deleteVotesAndVetoesOfClubs(db, clubIds),
    db.delete(ratingTags).where(inArray(ratingTags.ratingId, clubRatings)),
    db.delete(ratings).where(inArray(ratings.nightId, clubNights)),
    db.delete(rsvps).where(inArray(rsvps.nightId, clubNights)),
    db.delete(nominations).where(inArray(nominations.nightId, clubNights)),
    db.delete(nights).where(inArray(nights.clubId, clubIds)),
    db.delete(tags).where(inArray(tags.clubId, clubIds)),
    db.update(magicLinks).set({ inviteId: null }).where(inArray(magicLinks.inviteId, clubInvites)),
    db.delete(invites).where(inArray(invites.clubId, clubIds)),
    db.delete(constraints).where(inArray(constraints.membershipId, clubMemberships)),
    db.delete(memberships).where(inArray(memberships.clubId, clubIds)),
    db.delete(seasons).where(inArray(seasons.clubId, clubIds)),
    db.delete(clubs).where(inArray(clubs.id, clubIds)),
  ];
}

// Enter the code: the account is deleted. One batch, so it all lands or
// none of it does (neon-http has no transactions): ownership passes on,
// last-member clubs go, the requests go, then §11.4's anonymisation, which
// ends every session and releases the address. The receipt goes to the
// old address only once that has happened, so nobody is ever told their
// account was deleted when it wasn't.
export async function confirmAccountDeletion(db: Db, user: User, rawCode: string, now: Date): Promise<DeletionResult> {
  const row = await newestOpen(db, user.id);
  if (!row) return { ok: false, error: "There's no deletion waiting. Ask for a new code." };
  const state = evaluateDeletionRequest(row, now);
  if (state === "expired") return { ok: false, error: "That code has expired. Ask for a new one." };
  if (state === "locked") return { ok: false, error: "Too many wrong codes. Ask for a new one." };

  if (!codeMatches(rawCode.replace(/\s+/g, ""), row.codeHash, getAuthSecret())) {
    const attempts = row.attempts + 1;
    await db.update(accountDeletionRequests).set({ attempts }).where(eq(accountDeletionRequests.id, row.id));
    return {
      ok: false,
      error: attempts >= CODE_MAX_ATTEMPTS ? "Too many wrong codes. Ask for a new one." : "That code didn't work.",
    };
  }

  // Consumed conditionally: a double submit loses cleanly.
  const [consumed] = await db
    .update(accountDeletionRequests)
    .set({ consumedAt: now })
    .where(
      and(
        eq(accountDeletionRequests.id, row.id),
        isNull(accountDeletionRequests.consumedAt),
        isNull(accountDeletionRequests.cancelledAt),
      ),
    )
    .returning({ id: accountDeletionRequests.id });
  if (!consumed) return { ok: false, error: "That code didn't work. Ask for a new one." };

  const plan = await deletionPlanFor(db, user.id);
  const statements: BatchItem<"pg">[] = [];
  for (const club of plan) {
    if (club.action !== "transfer") continue;
    statements.push(
      db.update(memberships).set({ role: "owner" }).where(eq(memberships.id, club.toMembershipId)),
      // The departing owner's own row, marked left by the anonymisation
      // below, stops saying owner too.
      db
        .update(memberships)
        .set({ role: "member" })
        .where(and(eq(memberships.clubId, club.clubId), eq(memberships.userId, user.id), isNull(memberships.leftAt))),
    );
  }
  const doomed = plan.filter((c) => c.action === "delete_club").map((c) => c.clubId);
  if (doomed.length) statements.push(...clubDeletionStatements(db, doomed));
  statements.push(db.delete(accountDeletionRequests).where(eq(accountDeletionRequests.userId, user.id)));
  statements.push(...(await anonymisationStatements(db, user.id, now)));
  await db.batch(statements as [BatchItem<"pg">, ...BatchItem<"pg">[]]);

  await sendAccountDeletedReceipt(user.email);
  return { ok: true };
}
