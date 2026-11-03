import { and, eq, isNull } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { memberships, users } from "@/db/schema";
import { getSessionUserId } from "@/app/session";

// Session gates for pages (docs/onboarding-spec.md §5.1). Everything
// except the marketing page, the invite landing, the sign-in flow and the
// legal pages needs a session; club routes also need an active membership.

function loginUrl(returnTo: string) {
  return `/login?${new URLSearchParams({ returnTo })}`;
}

// Signed in, or off to /login — coming back to `returnTo` afterwards.
export async function requireUser(returnTo: string) {
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const userId = await getSessionUserId(db);
  if (!userId) redirect(loginUrl(returnTo));
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) redirect(loginUrl(returnTo));
  return user;
}

// Signed in and named. An account with no name yet goes through /welcome
// first, then on to `returnTo`.
export async function requireNamedUser(returnTo: string) {
  const user = await requireUser(returnTo);
  if (!user.displayName) redirect(`/welcome?${new URLSearchParams({ next: returnTo })}`);
  return { ...user, displayName: user.displayName };
}

// A club page: signed in, and an active member of this club. Anyone else
// gets a 404, not a 403 — a 403 would confirm the club exists.
export async function requireClubMember(clubId: string, returnTo: string) {
  const user = await requireUser(returnTo);
  const db = getDb();
  const [membership] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.clubId, clubId), eq(memberships.userId, user.id), isNull(memberships.leftAt)));
  if (!membership) notFound();
  return { user, membership };
}
