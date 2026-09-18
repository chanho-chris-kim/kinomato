import { and, eq, inArray } from "drizzle-orm";
import type { getDb } from "@/db";
import {
  constraints,
  films,
  memberships,
  nights,
  nominations,
  rsvps,
  votes,
} from "@/db/schema";
import { pickWinningNomination } from "@/lib/lockTally";

// The actual lock work, split out from the "use server" action in
// actions.ts so it has exactly one caller-independent entry point —
// usable both from a request (the manual "Lock it in" button) and,
// eventually, from a scheduled job with no cookie/request context at
// all. Doesn't touch identity: locking has no attribution column
// (unlike confirmNight's confirmed_by), so there's nothing here that
// needs to know who — or what — triggered it.
//
// SEAM for the scheduled lock job (CLAUDE.md's Stack section: Cloudflare
// Cron Triggers replace Vercel Cron). Not built here — analysis-v1.md
// §1.1 stage 8 says lock happens "24 hours before the night," but
// nothing today reads a per-club offset for that ("the club's lock_time
// setting" doesn't exist yet in clubs.settings, the same JSONB
// getNomineesPerTurn reads from). Wiring it needs, in order:
//   1. A `lockTime` (or similar) key added to clubs.settings, read the
//      same defensive way lib/clubSettings.ts reads nomineesPerTurn.
//   2. A Cloudflare Cron Trigger in wrangler.jsonc (e.g. every 15 min)
//      and a `scheduled` handler exported alongside the Worker.
//   3. That handler selects every night where state = 'open' and
//      scheduled_at - lockTime <= now(), and calls lockNightCore(db,
//      night.id) for each — the same function the button calls, so
//      "locked by a person" and "locked by the clock" can never drift
//      into two different code paths with two different bugs.
export async function lockNightCore(
  db: ReturnType<typeof getDb>,
  nightId: string,
): Promise<void> {
  const [night] = await db.select().from(nights).where(eq(nights.id, nightId));
  if (!night) throw new Error("Night not found.");
  if (night.state !== "open") return; // already locked (or never opened) — no-op

  const nightNominations = await db
    .select({ id: nominations.id, filmId: nominations.filmId })
    .from(nominations)
    .where(eq(nominations.nightId, nightId));
  if (nightNominations.length === 0) {
    throw new Error("Nothing to lock — this night has no nominations.");
  }

  const nominationIds = nightNominations.map((n) => n.id);
  const nightVotes = await db
    .select({ nominationId: votes.nominationId })
    .from(votes)
    .where(inArray(votes.nominationId, nominationIds));

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

  const clubMemberships = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(eq(memberships.clubId, night.clubId));
  const clubMembershipIds = clubMemberships.map((m) => m.id);
  const clubConstraints = clubMembershipIds.length
    ? await db.select().from(constraints).where(inArray(constraints.membershipId, clubMembershipIds))
    : [];

  const nightRsvps = await db
    .select({ membershipId: rsvps.membershipId, status: rsvps.status })
    .from(rsvps)
    .where(eq(rsvps.nightId, nightId));

  const winningNominationId = pickWinningNomination({
    nominations: nightNominations,
    votes: nightVotes,
    films: nominatedFilms,
    constraints: clubConstraints,
    rsvps: nightRsvps.filter(
      (r): r is { membershipId: string; status: "yes" | "no" } => r.status !== null,
    ),
  });
  if (!winningNominationId) {
    throw new Error("Nothing to lock — this night has no nominations.");
  }
  const winningFilmId = nightNominations.find((n) => n.id === winningNominationId)!.filmId;

  // Conditional on state still being "open" — the whole race guard, same
  // shape as confirmNight: if two members click "Lock it in" at nearly
  // the same moment, whichever write lands second matches zero rows and
  // is silently a no-op rather than double-locking or throwing.
  await db
    .update(nights)
    .set({ state: "locked", winningFilmId, lockedAt: new Date() })
    .where(and(eq(nights.id, nightId), eq(nights.state, "open")));
}
