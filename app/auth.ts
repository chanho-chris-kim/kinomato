import { and, eq, isNull } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db";
import { memberships, users } from "@/db/schema";
import { getSessionUserId } from "@/app/session";
import { consentGapsFor } from "@/app/consent";

// Session gates for pages and server actions (docs/onboarding-spec.md
// §5.1). Everything except the marketing page, the invite landing, the
// sign-in flow and the legal pages needs a session; club routes also need
// an active membership. And every one of them needs current consent and
// an age (§11.1, §11.3), checked here so no signed-in route can skip it:
// lib/consentGate.test.ts fails any route that doesn't come through these.

function loginUrl(returnTo: string) {
  return `/login?${new URLSearchParams({ returnTo })}`;
}

// Signed in, or off to /login, with no consent check: only for what the
// consent gate exempts (/consent itself, Sign out everywhere), so nobody
// is trapped. lib/consentGate.test.ts keeps it there.
// Session cookie before any database call (app/session.ts).
export async function requireSignedInIgnoringConsent(returnTo: string) {
  const userId = await getSessionUserId();
  if (!userId) redirect(loginUrl(returnTo));
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) redirect(loginUrl(returnTo));
  return user;
}

// Signed in, or off to /login — coming back to `returnTo` afterwards.
export async function requireUser(returnTo: string) {
  const user = await requireSignedInIgnoringConsent(returnTo);
  const db = getDb();
  // No banner-and-continue (§11.1): a stale version or an age never asked
  // blocks the page. An account with no name yet gets it all at /welcome.
  if ((await consentGapsFor(db, user)).length > 0) {
    const step = user.displayName ? "/consent" : "/welcome";
    redirect(`${step}?${new URLSearchParams({ next: returnTo })}`);
  }
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
