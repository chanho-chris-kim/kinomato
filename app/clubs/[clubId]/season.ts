import { and, eq, isNull } from "drizzle-orm";
import type { getDb } from "@/db";
import { seasons } from "@/db/schema";

// Vetoes need a season to attach their per-member pool to (vetoes.season_id
// is NOT NULL), but nothing in the app creates a season yet — there's no
// season UI or lifecycle built. This finds the club's current season (the
// one with no end date) or creates one, just enough for castVeto to have
// somewhere to point. Season start/end policy itself is undesigned.
export async function getOrCreateCurrentSeasonId(
  db: ReturnType<typeof getDb>,
  clubId: string,
): Promise<string> {
  const [existing] = await db
    .select({ id: seasons.id })
    .from(seasons)
    .where(and(eq(seasons.clubId, clubId), isNull(seasons.endedAt)));
  if (existing) return existing.id;

  const [created] = await db.insert(seasons).values({ clubId }).returning({ id: seasons.id });
  return created.id;
}
