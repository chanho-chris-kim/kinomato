import { and, eq, lt, sql } from "drizzle-orm";
import type { getDb } from "@/db";
import { magicLinks } from "@/db/schema";
import { CODE_MAX_ATTEMPTS, codeMatches, evaluateSignIn, getAuthSecret } from "@/lib/authCredentials";

// Checking a typed sign-in code (docs/onboarding-spec.md §4.3), for
// app/login/code/actions.ts. Free of request context, so
// e2e/code-lock-race.spec.ts can call it with guesses in flight at once.

type Db = ReturnType<typeof getDb>;
type Link = { id: string; codeHash: string | null; attempts: number; expiresAt: Date; consumedAt: Date | null };
export type CodeCheck =
  | { ok: true }
  | { ok: false; error: "expired" | "consumed" | "locked" }
  | { ok: false; error: "wrong"; left: number };

// Each guess first claims one of the CODE_MAX_ATTEMPTS tries, in one
// conditional update, and only then is compared. Read-then-compare let
// simultaneous guesses all see the same count and all be compared: ten at
// once got ten comparisons. Now the database hands out five tries, the
// right code included, and nothing else is compared.
export async function checkSignInCode(db: Db, link: Link, code: string, now: Date): Promise<CodeCheck> {
  const state = evaluateSignIn(link, now);
  if (state !== "usable") return { ok: false, error: state };
  const [claimed] = await db
    .update(magicLinks)
    .set({ attempts: sql`${magicLinks.attempts} + 1` })
    .where(and(eq(magicLinks.id, link.id), lt(magicLinks.attempts, CODE_MAX_ATTEMPTS)))
    .returning({ attempts: magicLinks.attempts });
  if (!claimed) return { ok: false, error: "locked" };
  if (codeMatches(code, link.codeHash, getAuthSecret())) return { ok: true };
  const left = CODE_MAX_ATTEMPTS - claimed.attempts;
  return left <= 0 ? { ok: false, error: "locked" } : { ok: false, error: "wrong", left };
}
