import { and, asc, eq, exists, inArray, isNull, ne, notExists } from "drizzle-orm";
import type { getDb } from "@/db";
import { clubs, memberships, nights } from "@/db/schema";
import { getAutoAdvance, getConfirmAt, getLockTime } from "@/lib/clubSettings";
import { dueToAutoPass, dueToLock, dueToUnconfirm } from "@/lib/nightDeadlines";
import { createDraftNightCore } from "./clubs/[clubId]/draftNightCore";
import { lockNightCore } from "./clubs/[clubId]/lockNightCore";
import { passDraftCore } from "./clubs/[clubId]/passTurnCore";
import { ScheduledJobFailure } from "./scheduledJobFailure";

type Db = ReturnType<typeof getDb>;

// The hourly weekly-loop job (ruled 2026-11-19/21; CLAUDE.md "Night
// deadlines"), run only by the Cron Trigger (wrangler.jsonc → worker.ts →
// app/scheduledJobs.ts); no route reaches it. worker.ts bundles this
// module's whole import graph outside Next's bundle, so nothing in it may
// import Next.js (lib/scheduledGraph.test.ts keeps it that way).
//
// For every club's night in flight, paused clubs included (pausing never
// ends the night in flight):
//   a. open, past its voting deadline (nights.lock_at): lockNightCore, the
//      button's own function. At most LOCKS_PER_RUN a run, oldest first;
//      the rest wait an hour.
//   b. locked, past nights.unconfirm_at, with the prompt showing: logged
//      unconfirmed. It consumes the picker's turn and never counts as
//      watched.
//   c. a draft still unopened when voting would have closed
//      (scheduled_at − lockTime): its turn passed, exactly as Pass my turn
//      does (passDraftCore).
//   e. a club with nothing in flight: its next draft night, exactly as
//      Tonight's lazy creation makes it (draftNightCore.ts, ruled
//      2026-11-22), at most DRAFTS_PER_RUN a run, after a/b/c so a night
//      that just resolved gets its successor in the same run.
// Nights from before deadlines were stored use the same fallbacks Tonight
// shows (lib/nightDeadlines.ts). Every write waits on the night's state,
// so a person pressing the same button at the same moment leaves one
// result and the other side a no-op, and a second run changes nothing.
//
// Each night is tried on its own: one failure doesn't stop the others.
// One log line of counts per run; a failed night also logs its id and
// what failed, never a name, email or other row data. Any failure throws
// at the end, so the run shows as failed (and app/scheduledJobs.ts emails
// an ops alert).

export const LOCKS_PER_RUN = 5;
// Drafts created a run; the rest wait an hour. Candidates are looked at a
// few times over, so clubs whose draft is declined don't starve the rest.
export const DRAFTS_PER_RUN = 10;
const DRAFT_CANDIDATES_PER_RUN = DRAFTS_PER_RUN * 5;

export interface WeeklyLoopCounts {
  locked: number;
  unconfirmed: number;
  passed: number;
  drafted: number;
  failed: number;
}

export async function runWeeklyLoop(
  db: Db,
  now: Date,
  // Tests only: limit the run to these clubs, so a time-travelled run
  // never touches the seeded ones. Production never passes it.
  opts: { clubIds?: string[] } = {},
): Promise<WeeklyLoopCounts> {
  const counts: WeeklyLoopCounts = { locked: 0, unconfirmed: 0, passed: 0, drafted: 0, failed: 0 };
  if (opts.clubIds && opts.clubIds.length === 0) return counts;

  const inFlight = await db
    .select({
      id: nights.id,
      state: nights.state,
      scheduledAt: nights.scheduledAt,
      pickerMembershipId: nights.pickerMembershipId,
      lockAt: nights.lockAt,
      lockedAt: nights.lockedAt,
      unconfirmAt: nights.unconfirmAt,
      settings: clubs.settings,
      timezone: clubs.timezone,
    })
    .from(nights)
    .innerJoin(clubs, eq(nights.clubId, clubs.id))
    .where(
      and(
        inArray(nights.state, ["draft", "open", "locked"]),
        opts.clubIds ? inArray(nights.clubId, opts.clubIds) : undefined,
      ),
    );

  const attempt = async (step: string, nightId: string, run: () => Promise<boolean>, count: keyof WeeklyLoopCounts) => {
    try {
      if (await run()) counts[count] += 1;
    } catch (err) {
      counts.failed += 1;
      // The night's id and what failed. Our own errors are fixed strings,
      // and these writes touch no personal columns.
      const what = err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 200) : "unknown error";
      console.error(`[weekly-loop] ${step} failed for ${step === "draft" ? "club" : "night"} ${nightId}: ${what}`);
    }
  };

  // a. Voting deadlines.
  const open = inFlight
    .filter((n) => n.state === "open")
    .map((n) => ({ ...n, lockTimeHours: getLockTime(n.settings) }));
  for (const night of dueToLock(open, now, LOCKS_PER_RUN)) {
    await attempt("lock", night.id, async () => (await lockNightCore(db, night.id)) !== "unchanged", "locked");
  }

  // b. Nobody confirmed.
  for (const night of inFlight.filter((n) => n.state === "locked")) {
    const due = dueToUnconfirm(
      {
        ...night,
        confirmAt: getConfirmAt(night.settings),
        autoAdvanceHours: getAutoAdvance(night.settings),
      },
      now,
    );
    if (!due) continue;
    await attempt(
      "unconfirm",
      night.id,
      async () => {
        const updated = await db
          .update(nights)
          .set({ state: "unconfirmed", unconfirmedAt: now, confirmedAt: now, confirmedBy: null })
          .where(and(eq(nights.id, night.id), eq(nights.state, "locked")))
          .returning({ id: nights.id });
        return updated.length > 0;
      },
      "unconfirmed",
    );
  }

  // c. A picker who never opened voting.
  for (const draft of inFlight.filter((n) => n.state === "draft")) {
    if (!dueToAutoPass({ scheduledAt: draft.scheduledAt, lockTimeHours: getLockTime(draft.settings) }, now)) continue;
    await attempt("pass", draft.id, () => passDraftCore(db, draft), "passed");
  }

  // e. Each club's next draft night (ruled 2026-11-22), after a/b/c so a
  // night that just resolved gets its successor in the same run.
  await draftNextNights(db, now, opts.clubIds, counts, attempt);

  console.log(`[weekly-loop] ${JSON.stringify(counts)}`);
  if (counts.failed > 0) throw new ScheduledJobFailure("weekly-loop", { ...counts });
  return counts;
}

// The same creation as Tonight's lazy one (draftNightCore.ts: rotation,
// schedule and anchor, paused skipped, ad_hoc never, departed members
// never picked), for clubs nobody has visited. Clubs with nothing in
// flight, not paused, not ad hoc and with someone active are candidates,
// oldest first; at most DRAFTS_PER_RUN drafts are made. A page load that
// won the race leaves "raced", which counts as nothing, not a failure.
// getDraftToCreate never offers a draft already due to be auto-passed: that
// slot is skipped and the following one drafted (ruled 2026-11-23).
async function draftNextNights(
  db: Db,
  now: Date,
  clubIds: string[] | undefined,
  counts: WeeklyLoopCounts,
  attempt: (step: string, id: string, run: () => Promise<boolean>, count: keyof WeeklyLoopCounts) => Promise<void>,
): Promise<void> {
  const candidates = await db
    .select()
    .from(clubs)
    .where(
      and(
        isNull(clubs.pausedAt),
        ne(clubs.cadence, "ad_hoc"),
        notExists(
          db
            .select({ id: nights.id })
            .from(nights)
            .where(and(eq(nights.clubId, clubs.id), inArray(nights.state, ["draft", "open", "locked"]))),
        ),
        exists(
          db
            .select({ id: memberships.id })
            .from(memberships)
            .where(and(eq(memberships.clubId, clubs.id), isNull(memberships.leftAt))),
        ),
        clubIds ? inArray(clubs.id, clubIds) : undefined,
      ),
    )
    .orderBy(asc(clubs.createdAt), asc(clubs.id))
    .limit(DRAFT_CANDIDATES_PER_RUN);
  if (candidates.length === 0) return;

  const ids = candidates.map((c) => c.id);
  const [allMemberships, allNights] = await Promise.all([
    // Every membership, left ones too: rotation carries a rejoiner's last
    // pick forward (lib/rotation.ts).
    db.select().from(memberships).where(inArray(memberships.clubId, ids)),
    db.select().from(nights).where(inArray(nights.clubId, ids)),
  ]);

  for (const club of candidates) {
    if (counts.drafted >= DRAFTS_PER_RUN) break;
    await attempt(
      "draft",
      club.id,
      async () =>
        (await createDraftNightCore(db, {
          clubId: club.id,
          club,
          memberships: allMemberships.filter((m) => m.clubId === club.id),
          nights: allNights.filter((n) => n.clubId === club.id),
          now,
        })) === "created",
      "drafted",
    );
  }
}
