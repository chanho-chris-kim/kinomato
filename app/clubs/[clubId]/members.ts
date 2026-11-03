import { eq, getTableColumns } from "drizzle-orm";
import type { getDb } from "@/db";
import { memberships, users } from "@/db/schema";

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

// Null only for an account that hasn't been through /welcome yet, or a
// legacy guest row during the step-4 cutover window (no account at all).
export function nameOf(member: { name: string | null } | null | undefined): string {
  return member?.name ?? "Unnamed member";
}
