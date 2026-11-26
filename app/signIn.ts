import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { getDb } from "@/db";
import { invites, magicLinks, users } from "@/db/schema";
import { getBaseUrl, safePath } from "@/app/baseUrl";
import { redeemDestination, redeemInvite } from "@/app/invites";
import { createSession, setSessionCookie } from "@/app/session";
import { recentEmailChangeSendsTo } from "@/app/emailChange";
import {
  checkSendAllowed,
  generateSignInCode,
  getAuthSecret,
  hashCode,
  hashToken,
  SIGN_IN_DURATION_MS,
} from "@/lib/authCredentials";
import { clearSignInEmailCookie } from "@/app/signInCookie";
import { sendInviteOnlyEmail, sendSignInEmail } from "@/lib/email";
import { INVITE_ONLY_MESSAGE, isSignupOpen, mayCreateAccount, signInEmailKind } from "@/lib/signupGate";

// Email sign-in (docs/onboarding-spec.md §4). One magic_links row per
// email sent, holding a link token and a 6-digit code — both only as
// hashes. The code is the primary path: it's typed into the tab that asked
// for it, which is the only thing that works for an installed iOS app
// (its cookies are separate from Safari's) and for invites opened inside
// chat apps. The link is the same-device convenience.
//
// Two ways in: plain sign-in/recovery, and from an invite (inviteId set —
// completing sign-in redeems it).
//
// Sign-up is invite-only until the legal text is signed off (§11.1, ruled
// 2026-11-18; lib/signupGate.ts): with OPEN_SIGNUP not "true", only an
// invite creates an account. An unknown address at /login is sent the
// invite-only email instead of a code, and completing a sign-in never
// creates an account without a live invite.

// The one place OPEN_SIGNUP is read (the marketing page asks here too).
export function signupOpen(): boolean {
  return isSignupOpen(process.env.OPEN_SIGNUP);
}


export type IssueResult = { sent: true } | { sent: false; retryAfterSeconds: number };

// Rate-limited per address (30s cooldown, 5 an hour). Callers show the
// same next screen either way and never reveal whether an account exists:
// verifying an email is what creates one.
export async function issueSignIn(
  db: ReturnType<typeof getDb>,
  params: {
    email: string;
    // From an invite landing page: completing sign-in redeems it.
    inviteId?: string;
  },
): Promise<IssueResult> {
  const now = new Date();
  const recent = await db
    .select({ createdAt: magicLinks.createdAt })
    .from(magicLinks)
    .where(
      and(
        eq(magicLinks.email, params.email),
        gt(magicLinks.createdAt, new Date(now.getTime() - 3600_000)),
      ),
    );
  // Shared with email changes (§5.9): their sends to this address count too.
  const changeSends = await recentEmailChangeSendsTo(db, params.email, new Date(now.getTime() - 3600_000));
  const allowed = checkSendAllowed(
    [...recent.map((r) => r.createdAt), ...changeSends],
    now,
  );
  if (!allowed.ok) return { sent: false, retryAfterSeconds: allowed.retryAfterSeconds };

  const accountExists = params.inviteId
    ? false
    : (await db.select({ id: users.id }).from(users).where(eq(users.email, params.email))).length > 0;
  const kind = signInEmailKind({ accountExists, fromInvite: Boolean(params.inviteId), signupOpen: signupOpen() });

  const token = crypto.randomUUID();
  const code = generateSignInCode();
  await db.insert(magicLinks).values({
    email: params.email,
    tokenHash: hashToken(token),
    // Invite-only: the row still counts against the send limits, and a
    // typed code meets the same "wrong code, N tries left" as anyone's,
    // but it can never be used. Its code hash is of a random UUID, which
    // no 6-digit code matches, its token is never sent, and
    // completeSignIn wouldn't create an account from it anyway.
    codeHash: hashCode(kind === "code" ? code : crypto.randomUUID(), getAuthSecret()),
    inviteId: params.inviteId ?? null,
    expiresAt: new Date(now.getTime() + SIGN_IN_DURATION_MS),
  });

  if (kind === "invite-only") {
    await sendInviteOnlyEmail(params.email);
    return { sent: true };
  }
  const verifyUrl = `${await getBaseUrl()}/verify?token=${token}`;
  await sendSignInEmail(params.email, code, verifyUrl);
  return { sent: true };
}

// The newest sign-in row for an address — the only one whose code is
// accepted. A new send supersedes the code of an older one.
export async function latestSignInFor(db: ReturnType<typeof getDb>, email: string) {
  const [row] = await db
    .select()
    .from(magicLinks)
    .where(eq(magicLinks.email, email))
    .orderBy(desc(magicLinks.createdAt))
    .limit(1);
  return row ?? null;
}

// Shared by the code form and the link's sign-in button. Consumes the row
// first, conditionally: a double submit or a code-and-link race loses
// cleanly (returns null) instead of signing in twice. With no account and
// no live invite while sign-up is closed, it signs nobody in and returns
// /login with the invite-only message. Otherwise returns the path to
// land on: the invite's club if it came from one, else `returnTo` (a
// same-origin path the code screen carried in its URL — the link from the
// email has none and lands on /), with /welcome first if the account
// still has no name.
export async function completeSignIn(
  db: ReturnType<typeof getDb>,
  signInId: string,
  returnTo?: string,
): Promise<string | null> {
  const [link] = await db
    .update(magicLinks)
    .set({ consumedAt: new Date() })
    .where(and(eq(magicLinks.id, signInId), isNull(magicLinks.consumedAt)))
    .returning();
  if (!link) return null;

  // Find-or-create by email — a users row existing is what "verified" means
  // (CLAUDE.md); there's no separate flag. Creating one needs a live
  // invite while sign-up is closed; the row is consumed either way.
  const [existingUser] = await db.select().from(users).where(eq(users.email, link.email));
  let user = existingUser;
  if (!user) {
    const [invite] = link.inviteId
      ? await db
          .select({ redeemedAt: invites.redeemedAt, revokedAt: invites.revokedAt })
          .from(invites)
          .where(eq(invites.id, link.inviteId))
      : [];
    if (!mayCreateAccount({ signupOpen: signupOpen(), invite: invite ?? null })) {
      await clearSignInEmailCookie();
      return `/login?${new URLSearchParams({ error: INVITE_ONLY_MESSAGE })}`;
    }
    user = (await db.insert(users).values({ email: link.email }).returning())[0];
  }

  await setSessionCookie(await createSession(db, user.id));
  // Signed in: the address the code screen was holding is done with.
  await clearSignInEmailCookie();

  const withNameStep = (destination: string, inviteId?: string) => {
    if (user.displayName) return destination;
    const qs = new URLSearchParams({ next: destination });
    if (inviteId) qs.set("invite", inviteId);
    return `/welcome?${qs.toString()}`;
  };

  if (link.inviteId) {
    // No name yet: the name step joins them, once their display name is
    // chosen and checked against the club's (ruled 2026-11-25), so a clash
    // never leaves a membership behind.
    if (!user.displayName) return withNameStep("/", link.inviteId);
    return redeemDestination(await redeemInvite(db, link.inviteId, user.id));
  }
  return withNameStep(safePath(returnTo));
}
