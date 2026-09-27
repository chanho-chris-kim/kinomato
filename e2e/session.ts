import { test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import { hashToken } from "../lib/authCredentials";

// Must match SESSION_COOKIE_NAME in app/session.ts. Not imported from
// there: that module pulls in next/headers, which has no business in the
// Playwright runner.
const SESSION_COOKIE_NAME = "kinomato_session";

// Signs a page in as the account behind a seeded membership, without
// going through the UI: inserts a `sessions` row straight into the E2E
// database and sets the session cookie on the page's browser context.
// A test helper, never an app route (docs/onboarding-spec.md §8.3) — the
// same kind of direct database write e2e/signIn.ts does for sign-in
// codes.
//
// Works against today's identity resolution because it already falls back
// from the per-club cookie to the session (app/clubs/[clubId]/identity.ts).
// It replaces clicking a name in the picker, which step 4 of the rebuild
// removes — tests on this helper don't notice that step.
//
// Only for memberships with an account. The seed's remaining guests
// (club 7's Wes and Uma) exist for the claim-flow tests, which still pick
// a name on purpose.
export async function signInAs(page: Page, membershipId: string): Promise<void> {
  const client = postgres(process.env.E2E_DATABASE_URL!);
  const db = drizzle(client, { schema });
  try {
    const [membership] = await db
      .select({ userId: schema.memberships.userId })
      .from(schema.memberships)
      .where(eq(schema.memberships.id, membershipId));
    if (!membership) {
      throw new Error(`signInAs: no membership ${membershipId} in the E2E database.`);
    }
    if (!membership.userId) {
      throw new Error(
        `signInAs: membership ${membershipId} is a guest with no account — ` +
          "pick the name on the club page instead.",
      );
    }
    const token = crypto.randomUUID();
    await db.insert(schema.sessions).values({
      userId: membership.userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    await page.context().addCookies([
      { name: SESSION_COOKIE_NAME, value: token, url: test.info().project.use.baseURL! },
    ]);
  } finally {
    await client.end();
  }
}
