import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { magicLinks, memberships, users } from "@/db/schema";
import { identityCookieName } from "@/app/clubs/[clubId]/identity";
import { createSession, setSessionCookie } from "@/app/session";
import { cookies } from "next/headers";

// The one entry point both magic-link flows (CLAUDE.md) land on — a
// plain login/recovery link and a claim link differ only in whether
// magicLinks.claimMembershipId is set, not in which route handles them.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts

  if (!token) {
    return NextResponse.redirect(new URL("/login?error=Missing+link.", url));
  }

  const [link] = await db.select().from(magicLinks).where(eq(magicLinks.token, token));
  if (
    !link ||
    link.consumedAt !== null ||
    link.expiresAt.getTime() < Date.now()
  ) {
    return NextResponse.redirect(
      new URL("/login?error=" + encodeURIComponent("That link is invalid or has expired — request a new one."), url),
    );
  }

  await db.update(magicLinks).set({ consumedAt: new Date() }).where(eq(magicLinks.id, link.id));

  // Find-or-create by email — existence of a users row is what "verified"
  // means (CLAUDE.md), there's no separate verified flag to set.
  const [existingUser] = await db.select().from(users).where(eq(users.email, link.email));
  const user =
    existingUser ??
    (await db.insert(users).values({ email: link.email }).returning())[0];

  // Claim (CLAUDE.md's claim ruling): update the existing membership row
  // in place — never insert a new one, which is what keeps rotation
  // history (identityKey, last_picked_at) attached to the same row.
  // Only mutates a membership that's still unclaimed; if it was somehow
  // already claimed by someone else between the prompt and this click
  // (a narrow race, not handled further), this link still logs the
  // clicker in — it just doesn't steal the membership.
  if (link.claimMembershipId) {
    await db
      .update(memberships)
      .set({ userId: user.id, identityKey: user.id })
      .where(and(eq(memberships.id, link.claimMembershipId), isNull(memberships.userId)));
  }

  const sessionToken = await createSession(db, user.id);
  await setSessionCookie(sessionToken);

  if (link.returnToClubId) {
    const [membership] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(eq(memberships.clubId, link.returnToClubId), eq(memberships.userId, user.id)),
      );
    if (membership) {
      const cookieStore = await cookies();
      cookieStore.set(identityCookieName(link.returnToClubId), membership.id, {
        httpOnly: true,
        sameSite: "lax",
        path: `/clubs/${link.returnToClubId}`,
      });
    }
    return NextResponse.redirect(new URL(`/clubs/${link.returnToClubId}`, url));
  }

  return NextResponse.redirect(new URL("/", url));
}
