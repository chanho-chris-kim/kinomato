import { cookies } from "next/headers";
import { and, eq, gt, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions } from "@/db/schema";
import { hashToken } from "@/lib/authCredentials";

// The one identity cookie: site-wide, resolved once regardless of which
// club's page someone is on; which membership that is in a given club is
// looked up from it (app/clubs/[clubId]/identity.ts).
export const SESSION_COOKIE_NAME = "kinomato_session";

// Long-lived on purpose: this isn't the recovery mechanism (CLAUDE.md)
// — users.email is. A session cookie clear also clears this cookie;
// what actually survives that is requesting a fresh code, which
// re-finds the same users row by email and mints a new session here.
// 90 days is just "don't make someone re-verify constantly" on a
// device that keeps its cookies.
const SESSION_DURATION_MS = 90 * 24 * 60 * 60 * 1000;

export async function createSession(
  db: ReturnType<typeof getDb>,
  userId: string,
): Promise<string> {
  // The cookie carries the token; the table only ever sees its hash
  // (lib/authCredentials.ts), so a leaked table hands out no sessions.
  const token = crypto.randomUUID();
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
  });
  return token;
}

export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_MS / 1000,
  });
}

// The cookie first, the database only if there is one. Reading cookies()
// before anything else is what makes every session-gated page dynamic by
// construction: `next build` never gets as far as getDb(), which throws
// without DATABASE_URL — and Workers Builds has none at build time (it's
// a runtime Worker secret). Signed out costs no database call either.
export async function getSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const [session] = await getDb()
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())));
  return session?.userId ?? null;
}

// Sign out everywhere (docs/onboarding-spec.md §4.4, §5.9): deletes every
// session row for the user, this browser's included, and clears this
// browser's cookie. Any other device's cookie now matches no row, so its
// next request is signed out.
export async function endAllSessions(db: ReturnType<typeof getDb>, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
  (await cookies()).delete(SESSION_COOKIE_NAME);
}

// After an email change (§5.9): every other session for the user ends;
// this browser's stays signed in.
export async function endOtherSessions(db: ReturnType<typeof getDb>, userId: string): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  await db
    .delete(sessions)
    .where(
      token
        ? and(eq(sessions.userId, userId), ne(sessions.tokenHash, hashToken(token)))
        : eq(sessions.userId, userId),
    );
}

// Signs this browser out: deletes its session row and clears the cookie.
// (Ruling B's "Sign out and continue as Marco" — docs/onboarding-spec.md
// §7.4. "Sign out everywhere" is Settings, step 7.)
export async function endSession(db: ReturnType<typeof getDb>): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }
  cookieStore.delete(SESSION_COOKIE_NAME);
}
