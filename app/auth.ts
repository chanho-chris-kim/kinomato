import { and, eq, isNull } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db";
import { memberships } from "@/db/schema";
import { getSessionAccount } from "@/app/session";
import { needsConsent } from "@/lib/consent";
import { currentLegal } from "@/lib/legal";

// Session gates for pages and server actions (docs/onboarding-spec.md
// §5.1). Everything except the marketing page, the invite landing, the
// sign-in flow and the legal pages needs a session; club routes also need
// an active membership. And every one of them needs current consent and
// an age (§11.1, §11.3), checked here so no signed-in route can skip it:
// lib/consentGate.test.ts fails any route that doesn't come through these.
//
// Two round trips at most, each once per request (React cache()): the
// session, account and consent events together (app/session.ts
// getSessionAccount), then, on a club page, the membership.

function loginUrl(returnTo: string) {
  return `/login?${new URLSearchParams({ returnTo })}`;
}

// Signed in, or off to /login, with no consent check: only for what the
// consent gate exempts (/consent itself, Sign out everywhere), so nobody
// is trapped. lib/consentGate.test.ts keeps it there.
// Session cookie before any database call (app/session.ts).
export async function requireSignedInIgnoringConsent(returnTo: string) {
  const account = await getSessionAccount();
  if (!account) redirect(loginUrl(returnTo));
  return account.user;
}

// Signed in, or off to /login — coming back to `returnTo` afterwards.
export async function requireUser(returnTo: string) {
  const account = await getSessionAccount();
  if (!account) redirect(loginUrl(returnTo));
  const { user } = account;
  // No banner-and-continue (§11.1): a stale version or an age never asked
  // blocks the page. An account with no name yet gets it all at /welcome.
  if (needsConsent(user, account.consentEvents, currentLegal()).length > 0) {
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
  const membership = await activeMembership(clubId, user.id);
  if (!membership) notFound();
  return { user, membership };
}

// The account's active membership in a club, once per request per club
// (React cache()). Also the server actions' check (identity.ts).
export const activeMembership = cache(async (clubId: string, userId: string) => {
  const [membership] = await getDb()
    .select()
    .from(memberships)
    .where(and(eq(memberships.clubId, clubId), eq(memberships.userId, userId), isNull(memberships.leftAt)));
  return membership ?? null;
});
