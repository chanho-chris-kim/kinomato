import { eq, getTableColumns } from "drizzle-orm";
import type { getDb } from "@/db";
import { memberships, users } from "@/db/schema";
import { shownName } from "@/lib/displayName";

// Every membership in a club (left ones too — rotation carry-forward needs
// them), each with its person's name. Names live on users
// (docs/onboarding-spec.md §8.2), so this is the one place a club's pages
// get them from.
export async function loadClubMemberships(db: ReturnType<typeof getDb>, clubId: string) {
  return db
    .select({ ...getTableColumns(memberships), name: users.displayName })
    .from(memberships)
    .leftJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.clubId, clubId));
}

export type ClubMembership = Awaited<ReturnType<typeof loadClubMemberships>>[number];

// How a member's name shows on every club page (lib/displayName.ts): their
// display name, or "Unnamed member" before /welcome.
export function nameOf(member: { name: string | null } | null | undefined): string {
  return shownName(member?.name);
}
