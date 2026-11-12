"use server";

import { and, eq, exists, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import {
  clubs,
  invites,
  memberships,
  nights,
  nominations,
  ratings,
  ratingTags,
  rsvps,
  tags,
  votes,
  vetoes,
} from "@/db/schema";
import { getSessionUserId } from "@/app/session";
import { nominatableFilms } from "@/app/watchlistRead";
import { activeMemberCount, pendingInviteCount } from "@/app/invites";
import { canCreateInvite, generateInviteToken } from "@/lib/invites";
import { validateMemberName } from "@/lib/memberName";
import { getNomineesPerTurn, mergeClubSettings, readClubSettingsForm } from "@/lib/clubSettings";
import { checkFirstNight, firstNightRequired, readClubDetailsForm } from "@/lib/clubDetails";
import { canChangeRole, canRemove, canTransferOwnership, type Role, type RoleMember } from "@/lib/roles";
import { planLeave } from "@/lib/clubLeave";
import { clubDeletionStatements } from "@/app/clubDeletion";
import { clearFormEcho, setFormEcho } from "@/app/formEcho";
import { normalizeTag } from "@/lib/tags";
import { requireCurrentMembershipId } from "./identity";
import { lockNightCore } from "./lockNightCore";
import { NON_TERMINAL_STATES } from "./nightState";
import { getOrCreateCurrentSeasonId } from "./season";

// Identity is the session's user, through their membership in this club
// (./identity.ts). Nothing here trusts a client-supplied membership id —
// every action reads it back with requireCurrentMembershipId.

// The one owner-or-admin gate for club actions: closing voting, invites,
// "How this club runs" and pause (docs/onboarding-spec.md §5.10, ruled
// 2026-11-10: owner and admin have equal powers). Re-checked on every
// call: a Server Action is callable directly, not only from the page that
// rendered its form, so a member's forged post, or one from a page loaded
// before their role changed, is refused here.
async function requireOwnerOrAdmin(clubId: string, action: string) {
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const membershipId = await requireCurrentMembershipId(clubId);
  const [membership] = await db.select().from(memberships).where(eq(memberships.id, membershipId));
  if (!membership || membership.clubId !== clubId) {
    throw new Error("No identity set for this club — pick a name first.");
  }
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new Error(`Only the club owner or an admin can ${action}.`);
  }
  return { db, membership };
}

// Owner only: roles and ownership (ruled 2026-11-11). Re-checked on every
// call, like requireOwnerOrAdmin.
async function requireOwner(clubId: string, action: string) {
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const membershipId = await requireCurrentMembershipId(clubId);
  const [membership] = await db.select().from(memberships).where(eq(memberships.id, membershipId));
  if (!membership || membership.clubId !== clubId) {
    throw new Error("No identity set for this club — pick a name first.");
  }
  if (membership.role !== "owner") throw new Error(`Only the club owner can ${action}.`);
  return { db, membership };
}

// A target named by membership id, never by name (§11.6): a uuid, read
// back from the database, or null.
async function loadMembership(db: ReturnType<typeof getDb>, membershipId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(membershipId)) return null;
  const [row] = await db.select().from(memberships).where(eq(memberships.id, membershipId));
  return row ?? null;
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
//
// "Lock is immovable" (CLAUDE.md): once a night leaves "open", a vote
// is rejected. Rejected means a silent no-op, not a thrown error — the
// vote button only ever renders while a night is genuinely open, so the
// only way to reach this path is a stale tab left open from before lock
// (or direct tampering), the same "lost the race" shape confirmNight
// and lockNight already treat as benign rather than an app error. It's
// the DB write that's the actual guard: nothing about a vote cast here
// is allowed to touch the votes table once locked.
export async function castVote(clubId: string, nominationId: string) {
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const membershipId = await requireCurrentMembershipId(clubId);

  const [nomination] = await db
    .select({ nightId: nominations.nightId })
    .from(nominations)
    .where(eq(nominations.id, nominationId));
  if (!nomination) throw new Error("Nomination not found.");

  const [night] = await db.select().from(nights).where(eq(nights.id, nomination.nightId));
  if (!night || night.clubId !== clubId) throw new Error("Night not found.");
  if (night.state !== "open") return;

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

// Nominees come only from the picker's own watchlist — analysis-v1.md
// §1.1 stage 5 ("that person picks ... from their own list"), and
// CLAUDE.md's "the picker never loses their turn, only which film"
// ruling only makes sense because every nominee is theirs. Never
// trusts the client-submitted film ids without checking them against
// the picker's actual watchlist server-side (app/watchlistRead.ts).
//
// Hard limits (ruled 2026-11-12): nominatableFilms already leaves out
// whatever an active member's hard limit excludes (lib/eligibility.ts; a
// draft has no RSVPs, so every active member counts), so a forged post
// naming an excluded film is refused here exactly like one naming a film
// that isn't on the list. Nothing re-filters during voting; lock does,
// once (lockNightCore).
export async function openVoting(clubId: string, nightId: string, formData: FormData) {
  const membershipId = await requireCurrentMembershipId(clubId);
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts

  const [night] = await db.select().from(nights).where(eq(nights.id, nightId));
  if (!night || night.clubId !== clubId) {
    throw new Error("Night not found.");
  }
  if (night.pickerMembershipId !== membershipId) {
    throw new Error("Only this week's picker can open voting.");
  }
  if (night.state !== "draft") {
    throw new Error("This night already has nominations.");
  }

  const [club] = await db.select().from(clubs).where(eq(clubs.id, clubId));
  const cap = getNomineesPerTurn(club?.settings);

  // Never trust the cap from the client either — re-read it, don't
  // accept it as an argument.
  const requestedFilmIds = Array.from(new Set(formData.getAll("filmId").map(String))).slice(
    0,
    cap,
  );
  if (requestedFilmIds.length === 0) {
    throw new Error("Pick at least one film.");
  }

  // The picker's list as this club can see it (app/watchlistRead.ts) —
  // the same set Tonight's picker was offered.
  const userId = (await getSessionUserId())!;
  const ownedFilmIds = new Set((await nominatableFilms(db, clubId, userId)).films.map((f) => f.id));
  const filmIds = requestedFilmIds.filter((id) => ownedFilmIds.has(id));
  if (filmIds.length === 0) {
    throw new Error("None of the selected films are on your watchlist.");
  }

  await db.batch([
    db.update(nights).set({ state: "open" }).where(eq(nights.id, nightId)),
    ...filmIds.map((filmId) => db.insert(nominations).values({ nightId, filmId, membershipId })),
  ]);

  revalidatePath(`/clubs/${clubId}`);
}

// "Did you watch X?" (analysis-v1.md §1.1 stage 10). Anyone in the club
// can answer; first answer settles it. The conditional UPDATE below is
// the whole mechanism for that: it only touches a row still in a
// non-terminal state, so if two members submit at nearly the same
// moment, whichever write lands second matches zero rows and is
// silently a no-op — not an error, since losing that race is the
// expected shape of "first answer wins," not a bug to report.
//
// "We watched something else" is a deliberate omission — CLAUDE.md's
// Open Questions, not ruled on yet.
export async function confirmNight(
  clubId: string,
  nightId: string,
  outcome: "watched" | "cancelled",
) {
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const membershipId = await requireCurrentMembershipId(clubId);

  const updated = await db
    .update(nights)
    .set({ state: outcome, confirmedAt: new Date(), confirmedBy: membershipId })
    .where(
      and(
        eq(nights.id, nightId),
        eq(nights.clubId, clubId),
        inArray(nights.state, NON_TERMINAL_STATES),
      ),
    )
    .returning({ id: nights.id });

  if (updated.length === 0) return;

  revalidatePath(`/clubs/${clubId}`);
}

// Quality and fun, 0-10 in half-point steps — not specified anywhere in
// docs/, chosen as a reasonable default for an unstyled v0 slider.
// Upserts on (nightId, membershipId), same shape as setRsvp: a member
// can change their rating by resubmitting, not create a second row.
export async function submitRating(clubId: string, nightId: string, formData: FormData) {
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const membershipId = await requireCurrentMembershipId(clubId);

  const [night] = await db.select().from(nights).where(eq(nights.id, nightId));
  if (!night || night.clubId !== clubId) {
    throw new Error("Night not found.");
  }
  if (night.state !== "watched") {
    throw new Error("Only a watched night can be rated.");
  }

  const scoreQuality = Number(formData.get("scoreQuality"));
  const scoreFun = Number(formData.get("scoreFun"));
  if (!Number.isFinite(scoreQuality) || !Number.isFinite(scoreFun)) {
    throw new Error("Both scores are required.");
  }
  // The client component clamps to 0-10 via the number/range inputs'
  // min/max, but that's advisory HTML, not a guarantee — re-checked
  // here independently, never trusting what the client sent.
  if (scoreQuality < 0 || scoreQuality > 10 || scoreFun < 0 || scoreFun > 10) {
    throw new Error("Scores must be between 0 and 10.");
  }
  const hotTakeRaw = formData.get("hotTake");
  const hotTake =
    typeof hotTakeRaw === "string" && hotTakeRaw.trim() !== "" ? hotTakeRaw.trim() : null;

  await db
    .insert(ratings)
    .values({
      nightId,
      membershipId,
      scoreQuality: scoreQuality.toFixed(1),
      scoreFun: scoreFun.toFixed(1),
      hotTake,
    })
    .onConflictDoUpdate({
      target: [ratings.nightId, ratings.membershipId],
      set: { scoreQuality: scoreQuality.toFixed(1), scoreFun: scoreFun.toFixed(1), hotTake },
    });

  revalidatePath(`/clubs/${clubId}`);
}

// Tags on a rating (CLAUDE.md) — alongside the hot take, not replacing
// it. Club-scoped: "cozy" is one tag per club, not six near-duplicates
// across members, so adding a tag upserts onto the club's existing
// tags row rather than creating a new one. A rating row (and so its id)
// has to exist first — that's why this is a separate action from
// submitRating rather than folded into the same form; the tag-add UI
// only appears once a rating exists to attach tags to.
export async function addRatingTag(clubId: string, nightId: string, formData: FormData) {
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const membershipId = await requireCurrentMembershipId(clubId);

  const [rating] = await db
    .select()
    .from(ratings)
    .where(and(eq(ratings.nightId, nightId), eq(ratings.membershipId, membershipId)));
  if (!rating) {
    throw new Error("Rate the film before tagging it.");
  }

  const raw = formData.get("tag");
  const normalized = typeof raw === "string" ? normalizeTag(raw) : null;
  if (!normalized) return;

  const [existingTag] = await db
    .select()
    .from(tags)
    .where(and(eq(tags.clubId, clubId), eq(tags.name, normalized.name)));
  let tagId = existingTag?.id;

  if (!tagId) {
    const [inserted] = await db
      .insert(tags)
      .values({ clubId, name: normalized.name, displayName: normalized.displayName })
      .onConflictDoNothing({ target: [tags.clubId, tags.name] })
      .returning({ id: tags.id });
    // onConflictDoNothing returns no row on a race (another member added
    // the same normalized tag between our select and insert) — re-read
    // rather than treat that as a failure, same shape as the films.tmdbId
    // race in app/filmCache.ts's ensureFilm. Whoever won the race set
    // displayName; that's the "first-seen casing" rule working as
    // intended, not a bug in this branch.
    if (inserted) {
      tagId = inserted.id;
    } else {
      const [wonByOther] = await db
        .select()
        .from(tags)
        .where(and(eq(tags.clubId, clubId), eq(tags.name, normalized.name)));
      tagId = wonByOther!.id;
    }
  }

  await db.insert(ratingTags).values({ ratingId: rating.id, tagId }).onConflictDoNothing();

  revalidatePath(`/clubs/${clubId}`);
}

// Scoped to the current membership's own rating — a member can only remove a tag from
// their own rating, never someone else's. There's no separate "edit"
// action: a club-scoped tag is a reference to a shared row, not free
// text on the rating, so changing which tag applies is remove-then-add,
// not a rename-in-place (a rename would silently relabel the tag for
// every other rating that shares it).
export async function removeRatingTag(clubId: string, nightId: string, tagId: string) {
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const membershipId = await requireCurrentMembershipId(clubId);

  const [rating] = await db
    .select()
    .from(ratings)
    .where(and(eq(ratings.nightId, nightId), eq(ratings.membershipId, membershipId)));
  if (!rating) return;

  await db
    .delete(ratingTags)
    .where(and(eq(ratingTags.ratingId, rating.id), eq(ratingTags.tagId, tagId)));

  revalidatePath(`/clubs/${clubId}`);
}

// "Close voting and set the pick" (analysis-v1.md §1.1 stage 8) —
// restricted to owner/admin (CLAUDE.md — overrides an earlier "any
// member" ruling). This button is scaffolding until the scheduled-lock
// cron exists; a member accidentally ending the vote early is a worse
// failure than waiting for an admin. There's no lockedBy column to
// attribute it to, unlike confirmNight — the role check is the shared
// requireOwnerOrAdmin. The actual tally/tiebreak/write is
// lockNightCore, shared with the not-yet-built scheduled job — see
// that file's SEAM comment.
export async function lockNight(clubId: string, nightId: string) {
  const { db } = await requireOwnerOrAdmin(clubId, "close voting");

  const [night] = await db.select().from(nights).where(eq(nights.id, nightId));
  if (!night || night.clubId !== clubId) throw new Error("Night not found.");

  await lockNightCore(db, nightId);

  revalidatePath(`/clubs/${clubId}`);
}


// Minimal seam, not the full veto feature (see CLAUDE.md's veto ruling
// for the intended shape — a token pool capped at two per member per
// season). This exists only to prove and test "no vetoes after lock";
// it doesn't enforce the pool cap, doesn't let the picker substitute a
// replacement nominee, and doesn't remove the vetoed film from the
// nominee list the UI renders. All of that is a separate, not-yet-
// started feature.
export async function castVeto(clubId: string, nominationId: string) {
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const membershipId = await requireCurrentMembershipId(clubId);

  const [nomination] = await db
    .select({ nightId: nominations.nightId })
    .from(nominations)
    .where(eq(nominations.id, nominationId));
  if (!nomination) throw new Error("Nomination not found.");

  const [night] = await db.select().from(nights).where(eq(nights.id, nomination.nightId));
  if (!night || night.clubId !== clubId) throw new Error("Night not found.");
  if (night.state !== "open") {
    throw new Error("Vetoes are only allowed before lock.");
  }

  const seasonId = await getOrCreateCurrentSeasonId(db, clubId);
  await db.insert(vetoes).values({
    nightId: nomination.nightId,
    nominationId,
    membershipId,
    seasonId,
  });

  revalidatePath(`/clubs/${clubId}`);
}

// ---- Per-person invites (docs/onboarding-spec.md §7, rebuild step 3) ----
// Owner/admin only (requireOwnerOrAdmin): all three change who can get
// into the room. Validation errors the person should see go back via
// ?inviteError= (CLAUDE.md's form-error convention).

function inviteError(clubId: string, message: string): never {
  redirect(`/clubs/${clubId}/members?inviteError=${encodeURIComponent(message)}`);
}

async function insertInvite(
  db: ReturnType<typeof getDb>,
  clubId: string,
  inviteeName: string,
  invitedByMembershipId: string,
) {
  const [invite] = await db
    .insert(invites)
    .values({ clubId, token: generateInviteToken(), inviteeName, invitedByMembershipId })
    .returning({ id: invites.id });
  return invite.id;
}

// Pending invites hold a seat, so this is refused once active members plus
// pending invites reach the cap. Lands back on the Members tab with the
// new invite's share panel open (?invite=).
export async function createInvite(clubId: string, formData: FormData) {
  const { db, membership } = await requireOwnerOrAdmin(clubId, "manage invites");
  const name = validateMemberName(
    String(formData.get("firstName") ?? ""),
    String(formData.get("lastInitial") ?? ""),
  );
  if ("error" in name) inviteError(clubId, name.error);

  const [active, pending] = await Promise.all([
    activeMemberCount(db, clubId),
    pendingInviteCount(db, clubId),
  ]);
  if (!canCreateInvite(active, pending)) {
    inviteError(clubId, "Every seat is taken or held by a pending invite. Revoke one to free a seat.");
  }

  const id = await insertInvite(db, clubId, name.displayName, membership.id);
  redirect(`/clubs/${clubId}/members?invite=${id}`);
}

// Kills one person's link without touching anyone else's (Ruling C). Only
// a pending invite: a redeemed one is history, and removing someone who
// joined is member removal, not this.
export async function revokeInvite(clubId: string, inviteId: string) {
  const { db } = await requireOwnerOrAdmin(clubId, "manage invites");
  await db
    .update(invites)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(invites.id, inviteId),
        eq(invites.clubId, clubId),
        isNull(invites.redeemedAt),
        isNull(invites.revokedAt),
      ),
    );
  redirect(`/clubs/${clubId}/members`);
}

// Revoke + a fresh invite for the same name: "I sent it to the wrong chat."
// The revoke frees the seat the new one takes, so it never trips the cap.
export async function regenerateInvite(clubId: string, inviteId: string) {
  const { db, membership } = await requireOwnerOrAdmin(clubId, "manage invites");
  const [revoked] = await db
    .update(invites)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(invites.id, inviteId),
        eq(invites.clubId, clubId),
        isNull(invites.redeemedAt),
        isNull(invites.revokedAt),
      ),
    )
    .returning();
  if (!revoked) redirect(`/clubs/${clubId}/members`);
  const id = await insertInvite(db, clubId, revoked.inviteeName, membership.id);
  redirect(`/clubs/${clubId}/members?invite=${id}`);
}

// ---- How this club runs (docs/onboarding-spec.md §5.10, ruled 2026-11-10) ----
// Owner or admin, equal powers. Changes apply from the next time they
// matter and never rewrite a night in flight: nominees per turn is read
// when the picker next opens voting; the confirm timing applies to
// whichever night is next confirmable. Validated at write time
// (lib/clubSettings.ts readClubSettingsForm); a mistake goes back with a
// fixed ?settingsError= message.
const settingsUrl = (clubId: string, query = "") => `/clubs/${clubId}/members${query}#club-settings`;

export async function updateClubSettings(clubId: string, formData: FormData) {
  const { db } = await requireOwnerOrAdmin(clubId, "change how the club runs");
  const result = readClubSettingsForm({
    nomineesPerTurn: formData.get("nomineesPerTurn"),
    confirmAt: formData.get("confirmAt"),
  });
  if (!result.ok) redirect(settingsUrl(clubId, `?${new URLSearchParams({ settingsError: result.error })}`));
  const [club] = await db.select({ settings: clubs.settings }).from(clubs).where(eq(clubs.id, clubId));
  await db
    .update(clubs)
    .set({ settings: mergeClubSettings(club?.settings, result.settings) })
    .where(eq(clubs.id, clubId));
  revalidatePath(`/clubs/${clubId}`, "layout");
  redirect(settingsUrl(clubId, "?saved=settings"));
}

// Pause or resume. Pausing never ends the night in flight (CLAUDE.md: the
// heading still names its picker); while paused no new draft is created
// (lib/rotation.ts getNextPicker), and resuming lets the next Tonight load
// create one from the next occurrence.
export async function setClubPaused(clubId: string, paused: boolean) {
  const { db } = await requireOwnerOrAdmin(clubId, paused ? "pause the club" : "resume the club");
  await db
    .update(clubs)
    .set({ pausedAt: paused ? new Date() : null })
    .where(eq(clubs.id, clubId));
  revalidatePath("/", "layout");
  redirect(settingsUrl(clubId));
}

// ---- Club details (docs/onboarding-spec.md §5.10, ruled 2026-11-10) ----
// Owner or admin: name, how often, day, time, timezone, mode. Validated by
// lib/clubDetails.ts, the same rules as /new, except that "no fixed
// schedule" isn't offered until nights can be scheduled by hand. Edits
// apply from the next night: a draft, open or locked night keeps its
// stored scheduled_at. A biweekly or monthly schedule whose counting would
// otherwise come from created_at needs "First night on", stored as
// settings.scheduleAnchor. A mistake comes back with a fixed
// ?detailsError= message; what was typed comes back through the form-echo
// cookie, never the URL (§11.6).
export async function updateClubDetails(clubId: string, formData: FormData) {
  const { db } = await requireOwnerOrAdmin(clubId, "edit the club's details");
  const membersPath = `/clubs/${clubId}/members`;
  await clearFormEcho(membersPath);
  const fields = {
    name: formData.get("name"),
    cadence: formData.get("cadence"),
    defaultDay: formData.get("defaultDay"),
    defaultTime: formData.get("defaultTime"),
    timezone: formData.get("timezone"),
    mode: formData.get("mode"),
  };
  const firstNightOn = formData.get("firstNightOn");
  const back = async (error: string): Promise<never> => {
    const echo: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...fields, firstNightOn })) {
      if (typeof value === "string") echo[key] = value;
    }
    await setFormEcho(membersPath, echo);
    redirect(`${membersPath}?${new URLSearchParams({ detailsError: error })}#club-details`);
  };

  const result = readClubDetailsForm(fields, { allowAdHoc: false });
  if (!result.ok) return back(result.error);
  const details = result.details;
  const [club] = await db.select().from(clubs).where(eq(clubs.id, clubId));
  if (!club) throw new Error("Club not found.");

  let settings = club.settings;
  if (firstNightRequired(club, details)) {
    const first = checkFirstNight(firstNightOn, details, new Date());
    if (!first.ok) return back(first.error);
    settings = { ...(typeof settings === "object" && settings !== null ? settings : {}), scheduleAnchor: first.date };
  }

  await db
    .update(clubs)
    .set({ ...details, settings })
    .where(eq(clubs.id, clubId));
  revalidatePath("/", "layout");
  redirect(`${membersPath}?saved=details#club-details`);
}

// ---- Roles and ownership (docs/onboarding-spec.md §5.10, ruled 2026-11-11) ----
// Only the owner makes or removes admins, and hands the club on; the rules
// are lib/roles.ts's, checked again here on every call. Admins and members
// change nobody's role: their posts are refused (thrown), as is anything
// the rules don't allow. Targets are membership ids.
const membersPath = (clubId: string, query = "") => `/clubs/${clubId}/members${query}`;
const asRoleMember = (m: { id: string; clubId: string; role: Role; leftAt: Date | null }): RoleMember => ({
  membershipId: m.id,
  clubId: m.clubId,
  role: m.role,
  leftAt: m.leftAt,
});

async function setAdmin(clubId: string, targetMembershipId: string, newRole: "admin" | "member") {
  const { db, membership: actor } = await requireOwner(clubId, "change roles");
  const target = await loadMembership(db, targetMembershipId);
  if (!target || !canChangeRole(asRoleMember(actor), asRoleMember(target), newRole)) throw new Error("That role change isn't allowed.");
  // Conditional on the row still being what the rules saw.
  await db
    .update(memberships)
    .set({ role: newRole })
    .where(
      and(
        eq(memberships.id, target.id),
        eq(memberships.clubId, clubId),
        isNull(memberships.leftAt),
        inArray(memberships.role, newRole === "admin" ? ["member", "guest"] : ["admin"]),
      ),
    );
  revalidatePath(`/clubs/${clubId}`, "layout");
  redirect(membersPath(clubId, "?roles=saved"));
}

export async function makeAdmin(clubId: string, targetMembershipId: string) {
  await setAdmin(clubId, targetMembershipId, "admin");
}

export async function removeAdmin(clubId: string, targetMembershipId: string) {
  await setAdmin(clubId, targetMembershipId, "member");
}

// The confirm step's POST (the Members tab's ?transfer= confirm card):
// the target becomes the owner and the old owner an admin, in one batch.
// The demotion only happens if the promotion did, so the club can never
// be left with no owner: if the target left in between, both statements
// match nothing. That race is expected, so it gets a message, not a throw.
export async function transferOwnership(clubId: string, targetMembershipId: string) {
  const { db, membership: actor } = await requireOwner(clubId, "hand the club on");
  const target = await loadMembership(db, targetMembershipId);
  if (!target || target.clubId !== clubId) throw new Error("That role change isn't allowed.");
  if (target.leftAt !== null) {
    redirect(membersPath(clubId, `?${new URLSearchParams({ rolesError: "That person isn't in the club any more." })}`));
  }
  if (!canTransferOwnership(asRoleMember(actor), asRoleMember(target))) throw new Error("That role change isn't allowed.");

  const targetIsNowOwner = sql`exists (select 1 from ${memberships} where ${memberships.id} = ${target.id} and ${memberships.role} = 'owner' and ${memberships.leftAt} is null)`;
  await db.batch([
    db
      .update(memberships)
      .set({ role: "owner" })
      .where(and(eq(memberships.id, target.id), eq(memberships.clubId, clubId), isNull(memberships.leftAt))),
    db
      .update(memberships)
      .set({ role: "admin" })
      .where(and(eq(memberships.id, actor.id), eq(memberships.role, "owner"), targetIsNowOwner)),
  ]);
  revalidatePath(`/clubs/${clubId}`, "layout");
  redirect(membersPath(clubId, "?roles=transferred"));
}

// ---- Leaving and removal (docs/onboarding-spec.md §5.10, ruled 2026-11-11) ----
// Both set left_at and nothing else about the person: their picks, votes
// and ratings stay in the club's history, and m0's rulings stop them
// counting toward reveals and lock. An open or locked night carries on.
// An *empty* draft night they were picking is deleted in the same batch
// (its RSVPs first), so the next Tonight load drafts for the next picker;
// a draft with nominations shouldn't exist (voting opening creates them)
// and is left in place and reported.

async function draftsWithNominations(db: ReturnType<typeof getDb>, clubId: string, membershipId: string) {
  const rows = await db
    .select({ id: nights.id })
    .from(nights)
    .where(
      and(
        eq(nights.clubId, clubId),
        eq(nights.pickerMembershipId, membershipId),
        eq(nights.state, "draft"),
        exists(db.select({ id: nominations.id }).from(nominations).where(eq(nominations.nightId, nights.id))),
      ),
    );
  return rows.length;
}

// `guard`: an extra condition every statement waits on (an owner's leave
// only happens once the heir is owner).
function departureStatements(
  db: ReturnType<typeof getDb>,
  clubId: string,
  membershipId: string,
  now: Date,
  guard?: SQL,
): BatchItem<"pg">[] {
  const emptyDrafts = db
    .select({ id: nights.id })
    .from(nights)
    .where(
      and(
        eq(nights.clubId, clubId),
        eq(nights.pickerMembershipId, membershipId),
        eq(nights.state, "draft"),
        sql`not exists (select 1 from ${nominations} where ${nominations.nightId} = ${nights.id})`,
        guard,
      ),
    );
  return [
    db.delete(rsvps).where(inArray(rsvps.nightId, emptyDrafts)),
    db.delete(nights).where(inArray(nights.id, emptyDrafts)),
    db
      .update(memberships)
      .set({ leftAt: now })
      .where(and(eq(memberships.id, membershipId), isNull(memberships.leftAt), guard)),
  ];
}

async function runDeparture(db: ReturnType<typeof getDb>, clubId: string, membershipId: string, statements: BatchItem<"pg">[]) {
  const kept = await draftsWithNominations(db, clubId, membershipId);
  await db.batch(statements as [BatchItem<"pg">, ...BatchItem<"pg">[]]);
  if (kept > 0) console.warn(`[departure] ${kept} draft night with nominations left in place`);
}

const activeOthers = (db: ReturnType<typeof getDb>, clubId: string, membershipId: string) =>
  db
    .select()
    .from(memberships)
    .where(and(eq(memberships.clubId, clubId), isNull(memberships.leftAt), ne(memberships.id, membershipId)));

// Leave (anyone; two-tap from the Members tab). The owner hands the club
// on first, to the account-deletion heir or to someone they chose, in the
// same batch: the heir is promoted only if still active, and the owner
// leaves only once the heir is owner, so the club is never ownerless. The
// last active member can't leave: they pause the club or delete it.
export async function leaveClub(clubId: string, chosenHeirMembershipId: string | null) {
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const meId = await requireCurrentMembershipId(clubId);
  const [me] = await db.select().from(memberships).where(eq(memberships.id, meId));
  const others = await activeOthers(db, clubId, me.id);
  const plan = planLeave(me.role, others.map((o) => ({ membershipId: o.id, role: o.role, joinedAt: o.joinedAt })));
  const back = (error: string) =>
    redirect(membersPath(clubId, `?${new URLSearchParams({ leave: "1", leaveError: error })}#leave`));
  const now = new Date();

  if (plan.kind === "last_member") back("You're the last member: pause the club or delete it.");
  if (plan.kind === "leave") {
    await runDeparture(db, clubId, me.id, departureStatements(db, clubId, me.id, now));
    revalidatePath("/", "layout");
    redirect("/");
  }
  if (plan.kind !== "transfer") return;

  const heirId = chosenHeirMembershipId ?? plan.heirMembershipId;
  const heir = others.find((o) => o.id === heirId);
  if (!heir) back("That person isn't in the club any more.");
  const heirIsOwner = sql`exists (select 1 from ${memberships} where ${memberships.id} = ${heirId} and ${memberships.role} = 'owner' and ${memberships.leftAt} is null)`;
  await runDeparture(db, clubId, me.id, [
    db
      .update(memberships)
      .set({ role: "owner" })
      .where(and(eq(memberships.id, heirId), eq(memberships.clubId, clubId), isNull(memberships.leftAt))),
    db
      .update(memberships)
      .set({ role: "member" })
      .where(and(eq(memberships.id, me.id), eq(memberships.role, "owner"), heirIsOwner)),
    ...departureStatements(db, clubId, me.id, now, heirIsOwner),
  ]);
  const [after] = await db.select({ leftAt: memberships.leftAt }).from(memberships).where(eq(memberships.id, me.id));
  if (!after?.leftAt) back("That person isn't in the club any more.");
  revalidatePath("/", "layout");
  redirect("/");
}

// Remove someone (two-tap from the Members tab): the owner removes anyone
// but themself, an admin plain members only (lib/roles.ts canRemove). The
// same as their leaving: left_at, history kept, the seat free at once.
// They can be invited again later.
export async function removeMember(clubId: string, targetMembershipId: string) {
  const { db, membership: actor } = await requireOwnerOrAdmin(clubId, "remove members");
  const target = await loadMembership(db, targetMembershipId);
  if (!target || !canRemove(asRoleMember(actor), asRoleMember(target))) {
    throw new Error("That removal isn't allowed.");
  }
  await runDeparture(db, clubId, target.id, departureStatements(db, clubId, target.id, new Date()));
  revalidatePath(`/clubs/${clubId}`, "layout");
  redirect(membersPath(clubId, "?removed=1#roles"));
}

// The last active member deletes the club: everything in it, by typing its
// exact name. The same statements as account deletion's last-member clubs
// (app/clubDeletion.ts), the recorded exception to "attribution is
// retained" (CLAUDE.md).
export async function deleteClubAsLastMember(clubId: string, formData: FormData) {
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const meId = await requireCurrentMembershipId(clubId);
  if ((await activeOthers(db, clubId, meId)).length > 0) {
    throw new Error("Only a club's last member can delete it.");
  }
  const [club] = await db.select({ name: clubs.name }).from(clubs).where(eq(clubs.id, clubId));
  if (!club) throw new Error("Club not found.");
  if (String(formData.get("confirmName") ?? "") !== club.name) {
    redirect(
      membersPath(clubId, `?${new URLSearchParams({ leave: "1", leaveError: "That isn't the club's name exactly." })}#leave`),
    );
  }
  await db.batch(clubDeletionStatements(db, [clubId]) as [BatchItem<"pg">, ...BatchItem<"pg">[]]);
  revalidatePath("/", "layout");
  redirect("/");
}
