import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { getDb } from "@/db";
import {
  clubs,
  constraints,
  films,
  memberships,
  nights,
  nominations,
  rsvps,
} from "@/db/schema";
import { getAutoAdvance, getConfirmAt } from "@/lib/clubSettings";
import { scopeToActiveMembers } from "@/lib/constraints";
import { filterNomineesAtLock } from "@/lib/eligibility";
import { pickWinningNomination } from "@/lib/lockTally";
import { unconfirmAtFor } from "@/lib/nightDeadlines";
import { votesForLock } from "./historyRead";

// The actual lock work, split out from the "use server" action in
// actions.ts so it has exactly one caller-independent entry point —
// usable both from a request (the manual "Close voting and set the pick"
// button, owner or admin: "close now") and from the scheduled job, with
// no cookie or request context at all. Doesn't touch identity: locking
// has no attribution column (unlike confirmNight's confirmed_by), so
// there's nothing here that needs to know who — or what — triggered it.
//
// Stored deadlines (ruled 2026-11-21, lib/nightDeadlines.ts). When voting
// opens, openVoting writes nights.lock_at: lockTime before the night, at
// least 6 hours from opening, never after the night starts. Here, at lock,
// nights.unconfirm_at is written: autoAdvance after the "did you watch
// it?" prompt (or the night, or the lock if later). Both are read from
// clubs.settings only at those two moments, so a settings change never
// moves a night already under way. The hourly job (the next step, beside
// the retention job in worker.ts) needs no settings or timezone math to
// find what's due: open nights with lock_at <= now come here, the same
// function the button calls, so "locked by a person" and "locked by the
// clock" can never drift into two code paths; locked nights with
// unconfirm_at <= now are logged unconfirmed; drafts still unopened when
// voting would have closed have their turn passed. Every write waits on
// the night's state, so the job and a person pressing the button at the
// same moment can't both act.
export async function lockNightCore(
  db: ReturnType<typeof getDb>,
  nightId: string,
): Promise<void> {
  const [night] = await db.select().from(nights).where(eq(nights.id, nightId));
  if (!night) throw new Error("Night not found.");
  if (night.state !== "open") return; // already locked (or never opened) — no-op

  const nightNominations = await db
    .select({ id: nominations.id, filmId: nominations.filmId, position: nominations.position })
    .from(nominations)
    .where(eq(nominations.nightId, nightId));
  if (nightNominations.length === 0) {
    throw new Error("Nothing to lock — this night has no nominations.");
  }

  // Nomination ids only, through the history-read module (the only code
  // that reads votes).
  const nightVotes = await votesForLock(db, nightId);

  const filmIds = nightNominations.map((n) => n.filmId);
  const nominatedFilms = await db
    .select({
      id: films.id,
      genreIds: films.genreIds,
      keywordIds: films.keywordIds,
      runtime: films.runtime,
      originalLanguage: films.originalLanguage,
    })
    .from(films)
    .where(inArray(films.id, filmIds));

  // Limits, preferences and RSVPs from members still active only
  // (2026-11-09 ruling, lib/constraints.ts scopeToActiveMembers): someone
  // who has left stops counting. Votes above are untouched: a departed
  // member's vote was cast while a member, and still counts.
  const activeMemberships = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.clubId, night.clubId), isNull(memberships.leftAt)));
  const activeMembershipIds = activeMemberships.map((m) => m.id);
  const clubConstraints = activeMembershipIds.length
    ? await db.select().from(constraints).where(inArray(constraints.membershipId, activeMembershipIds))
    : [];

  const nightRsvps = await db
    .select({ membershipId: rsvps.membershipId, status: rsvps.status })
    .from(rsvps)
    .where(eq(rsvps.nightId, nightId));

  const scoped = scopeToActiveMembers(
    clubConstraints,
    nightRsvps.filter((r): r is { membershipId: string; status: "yes" | "no" } => r.status !== null),
    activeMembershipIds,
  );

  // Hard limits, once, scoped by RSVP (ruled 2026-11-12): nominees a hard
  // limit now excludes are dropped (a member joined, or set a limit, during
  // voting) and the pick comes from the rest. Nothing says why. Their
  // votes stay in the table (attribution ruling) but don't count, and
  // History leaves them out.
  const { kept, dropped } = filterNomineesAtLock({
    nominations: nightNominations,
    films: nominatedFilms,
    ...scoped,
    activeMembershipIds,
  });
  const now = new Date();
  // Every write waits on the night still being open, so a lock that lost a
  // race changes nothing (the same guard as before, now over a batch).
  const stillOpen = sql`exists (select 1 from ${nights} where ${nights.id} = ${nightId} and ${nights.state} = 'open')`;
  const markDropped: BatchItem<"pg">[] = dropped.length
    ? [db.update(nominations).set({ droppedAt: now }).where(and(inArray(nominations.id, dropped), stillOpen))]
    : [];

  // None left: the night is cancelled with no pick. A cancelled night
  // doesn't consume a turn, so the same picker drafts again.
  if (kept.length === 0) {
    const cancel: BatchItem<"pg">[] = [
      ...markDropped,
      db
        .update(nights)
        .set({ state: "cancelled", confirmedAt: now })
        .where(and(eq(nights.id, nightId), eq(nights.state, "open"))),
    ];
    await db.batch(cancel as [BatchItem<"pg">, ...BatchItem<"pg">[]]);
    return;
  }

  const keptIds = new Set(kept.map((n) => n.id));
  const winningNominationId = pickWinningNomination({
    nominations: kept,
    votes: nightVotes.filter((v) => keptIds.has(v.nominationId)),
    films: nominatedFilms,
    ...scoped,
  });
  if (!winningNominationId) {
    throw new Error("Nothing to lock — this night has no nominations.");
  }
  const winningFilmId = kept.find((n) => n.id === winningNominationId)!.filmId;

  // When a night nobody confirms is logged as unconfirmed, stored now from
  // the club's settings as they are at lock (ruled 2026-11-21).
  const [club] = await db
    .select({ settings: clubs.settings, timezone: clubs.timezone })
    .from(clubs)
    .where(eq(clubs.id, night.clubId));
  const unconfirmAt = unconfirmAtFor({
    confirmAt: getConfirmAt(club?.settings),
    scheduledAt: night.scheduledAt,
    timezone: club.timezone,
    lockedAt: now,
    autoAdvanceHours: getAutoAdvance(club?.settings),
  });

  // Conditional on state still being "open" — the whole race guard, same
  // shape as confirmNight: if two people close voting at nearly
  // the same moment, whichever write lands second matches zero rows and
  // is silently a no-op rather than double-locking or throwing.
  const lock: BatchItem<"pg">[] = [
    ...markDropped,
    db
      .update(nights)
      .set({ state: "locked", winningFilmId, lockedAt: now, unconfirmAt })
      .where(and(eq(nights.id, nightId), eq(nights.state, "open"))),
  ];
  await db.batch(lock as [BatchItem<"pg">, ...BatchItem<"pg">[]]);
}
