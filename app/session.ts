import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import type { getDb } from "@/db";
import { sessions } from "@/db/schema";

// Site-wide, unlike every per-club kinomato_identity_{clubId} cookie
// (app/clubs/[clubId]/identity.ts) — a verified member's identity has
// to be resolved once, independent of which club's page they're on,
// before "which membership row in this club" can even be asked.
export const SESSION_COOKIE_NAME = "kinomato_session";

// Long-lived on purpose: this isn't the recovery mechanism (CLAUDE.md)
// — users.email is. A session cookie clear also clears this cookie;
// what actually survives that is requesting a fresh magic link, which
// re-finds the same users row by email and mints a new session here.
// 90 days is just "don't make someone re-verify constantly" on a
// device that keeps its cookies.
const SESSION_DURATION_MS = 90 * 24 * 60 * 60 * 1000;

export async function createSession(
  db: ReturnType<typeof getDb>,
  userId: string,
): Promise<string> {
  const token = crypto.randomUUID();
  await db.insert(sessions).values({
    userId,
    token,
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

export async function getSessionUserId(
  db: ReturnType<typeof getDb>,
): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const [session] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())));
  return session?.userId ?? null;
}
