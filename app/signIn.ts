import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { getDb } from "@/db";
import { magicLinks, users } from "@/db/schema";
import { getBaseUrl, safePath } from "@/app/baseUrl";
import { redeemDestination, redeemInvite } from "@/app/invites";
import { createSession, setSessionCookie } from "@/app/session";
import {
  checkSendAllowed,
  generateSignInCode,
  getAuthSecret,
  hashCode,
  hashToken,
} from "@/lib/authCredentials";
import { sendSignInEmail } from "@/lib/email";

// Email sign-in (docs/onboarding-spec.md §4). One magic_links row per
// email sent, holding a link token and a 6-digit code — both only as
// hashes. The code is the primary path: it's typed into the tab that asked
// for it, which is the only thing that works for an installed iOS app
// (its cookies are separate from Safari's) and for invites opened inside
// chat apps. The link is the same-device convenience.
//
// Two ways in: plain sign-in/recovery, and from an invite (inviteId set —
// completing sign-in redeems it).

// 15 minutes — short-lived on purpose, unlike the session it produces
// (app/session.ts). It's a one-time credential sitting in an inbox.
const SIGN_IN_DURATION_MS = 15 * 60 * 1000;

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
  const allowed = checkSendAllowed(
    recent.map((r) => r.createdAt),
    now,
  );
  if (!allowed.ok) return { sent: false, retryAfterSeconds: allowed.retryAfterSeconds };

  const token = crypto.randomUUID();
  const code = generateSignInCode();
  await db.insert(magicLinks).values({
    email: params.email,
    tokenHash: hashToken(token),
    codeHash: hashCode(code, getAuthSecret()),
    inviteId: params.inviteId ?? null,
    expiresAt: new Date(now.getTime() + SIGN_IN_DURATION_MS),
  });

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
// cleanly (returns null) instead of signing in twice. Returns the path to
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
  // (CLAUDE.md); there's no separate flag.
  const [existingUser] = await db.select().from(users).where(eq(users.email, link.email));
  const user = existingUser ?? (await db.insert(users).values({ email: link.email }).returning())[0];

  await setSessionCookie(await createSession(db, user.id));

  const withNameStep = (destination: string, inviteId?: string) => {
    if (user.displayName) return destination;
    const qs = new URLSearchParams({ next: destination });
    if (inviteId) qs.set("invite", inviteId);
    return `/welcome?${qs.toString()}`;
  };

  if (link.inviteId) {
    const result = await redeemInvite(db, link.inviteId, user.id);
    return withNameStep(redeemDestination(result), link.inviteId);
  }
  return withNameStep(safePath(returnTo));
}
