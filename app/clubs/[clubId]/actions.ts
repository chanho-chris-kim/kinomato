"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import {
  clubs,
  memberships,
  nights,
  nominations,
  ratings,
  ratingTags,
  rsvps,
  tags,
  votes,
  vetoes,
  watchlistItems,
} from "@/db/schema";
import { getNomineesPerTurn } from "@/lib/clubSettings";
import { normalizeTag } from "@/lib/tags";
import { identityCookieName, requireCurrentMembershipId } from "./identity";
import { lockNightCore } from "./lockNightCore";
import { NON_TERMINAL_STATES } from "./nightState";
import { getOrCreateCurrentSeasonId } from "./season";

// No auth in v0: identity is a membership id in a per-club cookie, set by
// picking a name from the club's member list. Nothing here trusts a
// client-supplied membership id — every action reads it back off the
// cookie itself (requireCurrentMembershipId, shared with the watchlist
// page's actions in ./list/actions.ts).

// Shared by the club home page and the watchlist page's own identity
// gate — one cookie, one picker, revalidate every route that reads it.
export async function pickIdentity(clubId: string, membershipId: string) {
  const cookieStore = await cookies();
  cookieStore.set(identityCookieName(clubId), membershipId, {
    httpOnly: true,
    sameSite: "lax",
    path: `/clubs/${clubId}`,
  });
  revalidatePath(`/clubs/${clubId}`);
  revalidatePath(`/clubs/${clubId}/list`);
}

export async function clearIdentity(clubId: string) {
  const cookieStore = await cookies();
  cookieStore.delete({ name: identityCookieName(clubId), path: `/clubs/${clubId}` });
  revalidatePath(`/clubs/${clubId}`);
  revalidatePath(`/clubs/${clubId}/list`);
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
// the picker's actual watchlist_items server-side.
//
// SEAM for lib/constraints.ts: hard limits aren't wired up yet. Once
// they are, filterEligibleFilms() belongs right here — filtering the
// picker's watchlist down to eligible films before nomination, using
// this club's active constraints and the current RSVPs for this
// night. That second input doesn't fully exist yet either: nothing in
// the app collects RSVPs before a night has nominations, so "the set
// of yes-RSVPs at nomination time" needs its own answer first.
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

  const pickerItems = await db
    .select({ filmId: watchlistItems.filmId })
    .from(watchlistItems)
    .where(eq(watchlistItems.membershipId, membershipId));
  const ownedFilmIds = new Set(pickerItems.map((item) => item.filmId));
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
    // rather than treat that as a failure, same shape as addFilm's
    // films.tmdbId race in ./list/actions.ts. Whoever won the race set
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

// Scoped to the current membership's own rating, same shape as
// removeFilm in ./list/actions.ts — a member can only remove a tag from
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
// attribute it to, unlike confirmNight — membership is only fetched
// here to check role. The actual tally/tiebreak/write is
// lockNightCore, shared with the not-yet-built scheduled job — see
// that file's SEAM comment.
export async function lockNight(clubId: string, nightId: string) {
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const membershipId = await requireCurrentMembershipId(clubId);

  const [membership] = await db
    .select()
    .from(memberships)
    .where(eq(memberships.id, membershipId));
  if (!membership || membership.clubId !== clubId) {
    throw new Error("No identity set for this club — pick a name first.");
  }
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new Error("Only the club owner or an admin can close voting.");
  }

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
