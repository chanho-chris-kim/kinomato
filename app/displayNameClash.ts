import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import type { getDb } from "@/db";
import { clubs, memberships, users } from "@/db/schema";
import { findClash } from "@/lib/displayName";

// Display names are unique within each club, case-insensitively, among
// active members (ruled 2026-11-25, built u2; the rule is lib/displayName.ts
// findClash). This loads who's in which club: everyone else active in the
// clubs given, never the person themself, never anyone who has left (so a
// "Former member", or anyone gone, frees their name). Checked in the
// server actions that join or rename; two people picking one name in the
// same instant is an accepted gap, as with the seat cap.

type Db = ReturnType<typeof getDb>;

// The first club, in the order given, where someone else active already
// goes by `name`, or null.
export async function clashingClub(db: Db, userId: string, name: string, clubIds: string[]): Promise<string | null> {
  if (clubIds.length === 0) return null;
  const [clubRows, others] = await Promise.all([
    db.select({ id: clubs.id, name: clubs.name }).from(clubs).where(inArray(clubs.id, clubIds)),
    db
      .select({ clubId: memberships.clubId, name: users.displayName })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(and(inArray(memberships.clubId, clubIds), isNull(memberships.leftAt), ne(memberships.userId, userId))),
  ]);
  return findClash(
    name,
    clubIds
      .map((id) => clubRows.find((c) => c.id === id))
      .filter((c): c is { id: string; name: string } => c !== undefined)
      .map((c) => ({ clubName: c.name, names: others.filter((o) => o.clubId === c.id).map((o) => o.name) })),
  );
}

// Every club the person is an active member of, by name: a rename must be
// unique in each, and the first that clashes is the one named.
export async function activeClubIdsByName(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: clubs.id, name: clubs.name })
    .from(memberships)
    .innerJoin(clubs, eq(memberships.clubId, clubs.id))
    .where(and(eq(memberships.userId, userId), isNull(memberships.leftAt)));
  return rows.sort((a, b) => a.name.localeCompare(b.name)).map((r) => r.id);
}
