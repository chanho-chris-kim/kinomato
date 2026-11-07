import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import { MEMBER_USER } from "../db/seed-fixtures";
import { LEGAL } from "../lib/legal";
import { expect, test } from "./fixtures";
import { BUMPED_TERMS_VERSION } from "./legalBump";
import { signInAsUser } from "./session";

// A version change sends everyone back through /consent (docs/onboarding-
// spec.md §11.1). Runs only against the second E2E server, whose Terms
// version is bumped (playwright.config.ts, the legal-bump project); same
// database, same seeded accounts. Eli and Dot accepted the current
// versions when seeded and only this spec signs in as them. Their bumped
// acceptances are removed afterwards, so the main server never sees an
// acceptance of a version it doesn't know.
test.describe.configure({ mode: "serial" });

const PEOPLE = [MEMBER_USER.eli, MEMBER_USER.dot];

async function withDb<T>(fn: (db: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>): Promise<T> {
  const client = postgres(process.env.E2E_DATABASE_URL!);
  try {
    return await fn(drizzle(client, { schema }));
  } finally {
    await client.end();
  }
}

test.describe("a bumped Terms version", () => {
  test.afterAll(async () => {
    await withDb((db) =>
      db
        .delete(schema.consentEvents)
        .where(and(inArray(schema.consentEvents.userId, PEOPLE), eq(schema.consentEvents.version, BUMPED_TERMS_VERSION))),
    );
  });

  test("sends every account to /consent, records a reconsent, then lets them through", async ({ page }) => {
    // The legal page already shows the new version.
    await page.goto("/terms");
    await expect(page.locator(".legal-version")).toContainText(BUMPED_TERMS_VERSION);

    for (const userId of PEOPLE) {
      await page.context().clearCookies();
      await signInAsUser(page, userId);
      await page.goto("/watchlist");
      await expect(page).toHaveURL(`/consent?${new URLSearchParams({ next: "/watchlist" })}`);
      // Only the Terms changed; the age was asked once already.
      await expect(page.locator("main")).toContainText("The Terms have changed.");
      await expect(page.getByLabel("18 or older")).toHaveCount(0);
      await expect(page.getByText(`(version ${BUMPED_TERMS_VERSION})`)).toBeVisible();
      await page.getByLabel(/^I agree to the Terms/).check();
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page).toHaveURL("/watchlist");

      const rows = await withDb((db) =>
        db.select().from(schema.consentEvents).where(eq(schema.consentEvents.userId, userId)),
      );
      // The seeded signup rows, plus one reconsent for the Terms only.
      expect(rows.map((r) => [r.document, r.version, r.method]).sort()).toEqual([
        ["privacy", LEGAL.privacy.version, "signup"],
        ["terms", LEGAL.terms.version, "signup"],
        ["terms", BUMPED_TERMS_VERSION, "reconsent"],
      ]);
      await page.goto("/");
      await expect(page).toHaveURL("/");
    }
  });
});
