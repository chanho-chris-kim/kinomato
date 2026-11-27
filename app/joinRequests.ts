import { and, asc, count, desc, eq, gt, inArray, isNotNull, lt, ne, or, sql } from "drizzle-orm";
import type { getDb } from "@/db";
import { clubs, joinCodeAttempts, joinRequests, memberships, users } from "@/db/schema";
import { activeMemberCount, findActiveMembership, pendingInviteCount } from "@/app/invites";
import { clashingClub } from "@/app/displayNameClash";
import { isUniqueViolation } from "@/lib/dbErrors";
import { shownName } from "@/lib/displayName";
import { sendJoinApproved } from "@/lib/email";
import { generateJoinCode, normaliseJoinCode } from "@/lib/joinCode";
import {
  approvalRefusal,
  askRefusal,
  DECLINE_COOLDOWN_DAYS,
  joinApprovedEmail,
  withinAttemptLimit,
} from "@/lib/joinRequests";

// Club codes and asking to join (u5, ruled 2026-11-25; details 2026-11-26).
// The only code that touches join_requests and join_code_attempts
// (lib/joinRequestAccess.test.ts). Request-free: no cookies or redirects,
// since the retention job (worker.ts, outside Next.js) reaches its deletes.
// Approvers only ever get a requester's display name from here.

type Db = ReturnType<typeof getDb>;

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

// Never says whether the code was wrong or switched off.
export const WRONG_CODE = "That code didn't work. Check it with someone in the club.";
export const TOO_MANY_TRIES = "Too many tries. Try again in an hour.";

// ---------------------------------------------------------------- codes

// Turn codes on with a fresh code, or make a new one: the old code stops
// working at once. A collision with another club's code regenerates.
export async function newJoinCode(db: Db, clubId: string): Promise<void> {
  for (let tries = 0; tries < 5; tries++) {
    try {
      await db.update(clubs).set({ joinCode: generateJoinCode() }).where(eq(clubs.id, clubId));
      return;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new Error("newJoinCode: five collisions in a row; the code space can't be that full.");
}

// Codes off. Pending requests stay, and can still be decided.
export async function turnJoinCodeOff(db: Db, clubId: string): Promise<void> {
  await db.update(clubs).set({ joinCode: null }).where(eq(clubs.id, clubId));
}

export type CodeLookup =
  | { ok: true; club: { id: string; name: string }; alreadyMember: boolean }
  | { ok: false; error: string };

// One try at a code. The try is recorded before the code is looked up, so
// simultaneous guesses each take one of the ten an hour; a right code gives
// its try back, so only wrong or switched-off codes count. Over the limit,
// the try isn't kept either: the limit is ten wrong codes in any hour.
export async function lookUpJoinCode(db: Db, userId: string, rawCode: unknown, now: Date): Promise<CodeLookup> {
  const [attempt] = await db
    .insert(joinCodeAttempts)
    .values({ userId, createdAt: now })
    .returning({ id: joinCodeAttempts.id });
  const [{ n }] = await db
    .select({ n: count() })
    .from(joinCodeAttempts)
    .where(and(eq(joinCodeAttempts.userId, userId), gt(joinCodeAttempts.createdAt, new Date(now.getTime() - HOUR_MS))));
  const giveBack = () => db.delete(joinCodeAttempts).where(eq(joinCodeAttempts.id, attempt.id));
  if (!withinAttemptLimit(n)) {
    await giveBack();
    return { ok: false, error: TOO_MANY_TRIES };
  }
  const code = normaliseJoinCode(rawCode);
  const [club] = code
    ? await db.select({ id: clubs.id, name: clubs.name }).from(clubs).where(eq(clubs.joinCode, code))
    : [];
  if (!club) return { ok: false, error: WRONG_CODE };
  await giveBack();
  return { ok: true, club, alreadyMember: (await findActiveMembership(db, club.id, userId)) !== null };
}

// -------------------------------------------------------------- requests

export type AskResult =
  | { ok: true; requestId: string; club: { id: string; name: string } }
  | { ok: false; error: string }
  | { ok: false; alreadyIn: { id: string; name: string } };

// "Ask to join {club}": the code is checked again (and counted again if
// it's wrong now), then the rules in lib/joinRequests.ts. At most one
// pending request per person per club is the partial unique index
// join_requests_one_pending_per_user_per_club; a second is refused by the
// database, not just here. The five-waiting limit is a plain count, an
// accepted gap under truly simultaneous requests, as with the seat cap.
export async function askToJoin(db: Db, userId: string, rawCode: unknown, now: Date): Promise<AskResult> {
  const found = await lookUpJoinCode(db, userId, rawCode, now);
  if (!found.ok) return found;
  if (found.alreadyMember) return { ok: false, alreadyIn: found.club };
  const mine = await db
    .select({ clubId: joinRequests.clubId, status: joinRequests.status, decidedAt: joinRequests.decidedAt })
    .from(joinRequests)
    .where(and(eq(joinRequests.userId, userId), or(eq(joinRequests.status, "pending"), eq(joinRequests.status, "declined"))));
  const pending = mine.filter((r) => r.status === "pending");
  const declinedAt =
    mine
      .filter((r) => r.clubId === found.club.id && r.status === "declined" && r.decidedAt)
      .map((r) => r.decidedAt!)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const refusal = askRefusal(
    { pendingHere: pending.some((r) => r.clubId === found.club.id), pendingCount: pending.length, declinedAt },
    found.club.name,
    now,
  );
  if (refusal) return { ok: false, error: refusal };
  try {
    const [row] = await db
      .insert(joinRequests)
      .values({ clubId: found.club.id, userId, createdAt: now })
      .returning({ id: joinRequests.id });
    return { ok: true, requestId: row.id, club: found.club };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: `You've already asked to join ${found.club.name}.` };
    throw error;
  }
}

// The confirm step's club, from what the lookup left in the form-echo
// cookie: shown only while that code is still this club's code, so a hand-
// made cookie can't be used to try codes without counting.
export async function clubForConfirmedCode(db: Db, clubId: unknown, code: unknown) {
  const normal = normaliseJoinCode(code);
  if (!normal || typeof clubId !== "string" || !/^[0-9a-f-]{36}$/i.test(clubId)) return null;
  const [club] = await db
    .select({ id: clubs.id, name: clubs.name })
    .from(clubs)
    .where(and(eq(clubs.id, clubId), eq(clubs.joinCode, normal)));
  return club ?? null;
}

// The requester's own cancel; only their own, only while pending.
export async function cancelJoinRequest(db: Db, userId: string, requestId: string, now: Date): Promise<void> {
  await db
    .update(joinRequests)
    .set({ status: "cancelled", decidedAt: now })
    .where(and(eq(joinRequests.id, requestId), eq(joinRequests.userId, userId), eq(joinRequests.status, "pending")));
}

// /join's list: the person's pending requests, and clubs that declined
// them in the last 30 days.
export async function myJoinRequests(db: Db, userId: string, now: Date) {
  const rows = await db
    .select({
      id: joinRequests.id,
      status: joinRequests.status,
      createdAt: joinRequests.createdAt,
      decidedAt: joinRequests.decidedAt,
      clubName: clubs.name,
    })
    .from(joinRequests)
    .innerJoin(clubs, eq(joinRequests.clubId, clubs.id))
    .where(
      and(
        eq(joinRequests.userId, userId),
        or(
          eq(joinRequests.status, "pending"),
          and(
            eq(joinRequests.status, "declined"),
            gt(joinRequests.decidedAt, new Date(now.getTime() - DECLINE_COOLDOWN_DAYS * DAY_MS)),
          ),
        ),
      ),
    )
    .orderBy(desc(joinRequests.createdAt));
  return {
    pending: rows.filter((r) => r.status === "pending").map((r) => ({ id: r.id, clubName: r.clubName, createdAt: r.createdAt })),
    declined: rows.filter((r) => r.status === "declined").map((r) => ({ id: r.id, clubName: r.clubName })),
  };
}

// ------------------------------------------------------------- approvers

// "Asking to join" on Members: the display name and when, nothing else.
export async function pendingRequestsFor(db: Db, clubId: string) {
  const rows = await db
    .select({ id: joinRequests.id, createdAt: joinRequests.createdAt, displayName: users.displayName })
    .from(joinRequests)
    .innerJoin(users, eq(joinRequests.userId, users.id))
    .where(and(eq(joinRequests.clubId, clubId), eq(joinRequests.status, "pending")))
    .orderBy(asc(joinRequests.createdAt));
  return rows.map((r) => ({ id: r.id, createdAt: r.createdAt, name: shownName(r.displayName) }));
}

// The Members tab's badge, for owners and admins only (the caller checks).
export async function pendingRequestCount(db: Db, clubId: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(joinRequests)
    .where(and(eq(joinRequests.clubId, clubId), eq(joinRequests.status, "pending")));
  return n;
}

export type DecideResult = { ok: true } | { ok: false; error: string | null };

// Approve: the seat cap (pending invites included), the display-name clash
// rule (u2) and "not already in" are checked first; any of them leaves the
// request pending with a message. Then one db.batch: the request is marked
// approved only while still pending, and the membership is created from
// that very approval (this approver, this instant). Two admins approving at
// once: the second's update finds it decided and its insert finds no
// approval of its own, so it does nothing; one that approves while another
// declines likewise leaves only the one that landed. The membership's
// active-row index stops any second membership whatever happens. Then
// "You're in {club}" goes to the requester.
export async function approveJoinRequest(
  db: Db,
  approverMembershipId: string,
  clubId: string,
  requestId: string,
  origin: string,
  now: Date,
): Promise<DecideResult> {
  const [request] = await db
    .select({ id: joinRequests.id, userId: joinRequests.userId, email: users.email, displayName: users.displayName, clubName: clubs.name })
    .from(joinRequests)
    .innerJoin(users, eq(joinRequests.userId, users.id))
    .innerJoin(clubs, eq(joinRequests.clubId, clubs.id))
    .where(and(eq(joinRequests.id, requestId), eq(joinRequests.clubId, clubId), eq(joinRequests.status, "pending")));
  if (!request) return { ok: false, error: null }; // decided already, or not this club's
  const name = shownName(request.displayName);
  const [alreadyMember, active, invited, clashIn] = await Promise.all([
    findActiveMembership(db, clubId, request.userId),
    activeMemberCount(db, clubId),
    pendingInviteCount(db, clubId),
    request.displayName ? clashingClub(db, request.userId, request.displayName, [clubId]) : Promise.resolve(null),
  ]);
  const refusal = approvalRefusal(
    { alreadyMember: alreadyMember !== null, active, pendingInvites: invited, clashIn },
    request.clubName,
    name,
  );
  if (refusal) return { ok: false, error: refusal };

  const ownApproval = and(
    eq(joinRequests.id, requestId),
    eq(joinRequests.status, "approved"),
    eq(joinRequests.decidedByMembershipId, approverMembershipId),
    eq(joinRequests.decidedAt, now),
  );
  let joined: unknown[];
  try {
    [, joined] = await db.batch([
      db
        .update(joinRequests)
        .set({ status: "approved", decidedAt: now, decidedByMembershipId: approverMembershipId })
        .where(and(eq(joinRequests.id, requestId), eq(joinRequests.status, "pending"))),
      db
        .insert(memberships)
        .select(
          db
            .select({
              id: sql`gen_random_uuid()`.as("id"),
              clubId: joinRequests.clubId,
              userId: joinRequests.userId,
              role: sql`'member'::membership_role`.as("role"),
              joinedAt: sql`${now.toISOString()}::timestamptz`.as("joined_at"),
              leftAt: sql`null::timestamptz`.as("left_at"),
              postponedAt: sql`null::timestamptz`.as("postponed_at"),
              remindersMutedAt: sql`null::timestamptz`.as("reminders_muted_at"),
              approvedByMembershipId: sql`${approverMembershipId}::uuid`.as("approved_by_membership_id"),
            })
            .from(joinRequests)
            .where(ownApproval),
        )
        .returning({ id: memberships.id }),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: null }; // in already, by another way
    throw error;
  }
  if (joined.length === 0) return { ok: false, error: null }; // someone else decided first
  await sendJoinApproved(request.email, joinApprovedEmail(request.clubName, `${origin}/clubs/${clubId}`));
  return { ok: true };
}

// Decline: no email. The requester sees "{club} didn't accept your
// request." on /join for 30 days, and can't ask that club again until then.
export async function declineJoinRequest(
  db: Db,
  deciderMembershipId: string,
  clubId: string,
  requestId: string,
  now: Date,
): Promise<void> {
  await db
    .update(joinRequests)
    .set({ status: "declined", decidedAt: now, decidedByMembershipId: deciderMembershipId })
    .where(and(eq(joinRequests.id, requestId), eq(joinRequests.clubId, clubId), eq(joinRequests.status, "pending")));
}

// ------------------------------------------------------------- lifecycle

// Download my data: the person's own requests, with the club's name.
export async function ownJoinRequests(db: Db, userId: string) {
  return db
    .select({
      clubName: clubs.name,
      status: joinRequests.status,
      askedAt: joinRequests.createdAt,
      decidedAt: joinRequests.decidedAt,
    })
    .from(joinRequests)
    .innerJoin(clubs, eq(joinRequests.clubId, clubs.id))
    .where(eq(joinRequests.userId, userId))
    .orderBy(asc(joinRequests.createdAt));
}

// Account deletion (§11.4): their requests and code tries go.
export function deleteJoinRequestsOf(db: Db, userId: string) {
  return [
    db.delete(joinRequests).where(eq(joinRequests.userId, userId)),
    db.delete(joinCodeAttempts).where(eq(joinCodeAttempts.userId, userId)),
  ] as const;
}

// Club deletion: the club's requests go, before its memberships (a decided
// request points at the membership that decided it).
export function deleteJoinRequestsOfClubs(db: Db, clubIds: string[]) {
  return db.delete(joinRequests).where(inArray(joinRequests.clubId, clubIds));
}

// Retention (lib/retention.ts): decided or cancelled requests 90 days after
// the decision, pending ones 30 days after they were made, code tries after
// a day.
export function deleteOldJoinRequests(db: Db, decidedBefore: Date, pendingBefore: Date) {
  return db
    .delete(joinRequests)
    .where(
      or(
        and(ne(joinRequests.status, "pending"), isNotNull(joinRequests.decidedAt), lt(joinRequests.decidedAt, decidedBefore)),
        and(eq(joinRequests.status, "pending"), lt(joinRequests.createdAt, pendingBefore)),
      ),
    )
    .returning({ id: joinRequests.id });
}

export function deleteOldJoinCodeAttempts(db: Db, before: Date) {
  return db.delete(joinCodeAttempts).where(lt(joinCodeAttempts.createdAt, before)).returning({ id: joinCodeAttempts.id });
}

// The Members tab's badge: the pending count for owners and admins, 0 for
// everyone else (plain members never see requests).
export async function askingBadge(db: Db, clubId: string, role: string): Promise<number> {
  return role === "owner" || role === "admin" ? pendingRequestCount(db, clubId) : 0;
}
