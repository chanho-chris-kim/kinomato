import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import { expect, test } from "./fixtures";
import { sentTo } from "./outbox";
import { finishCodeSignIn, nameYourself } from "./signIn";

// The open path: OPEN_SIGNUP=true (docs/onboarding-spec.md §11.1). Runs
// only against CI's open-signup server, on the same build and database
// (playwright.config.ts); the main server is closed (invite-only.spec.ts).

test.describe("open sign-up (OPEN_SIGNUP=true)", () => {
  test("Start a club is back, and a new address signs up by code and lands on Start your club", async ({ page }) => {
    const email = "open.signup@example.com";
    await page.goto("/");
    await expect(page.locator("main").getByText("Invite-only for now", { exact: true })).toHaveCount(0);
    await page.locator("main").getByRole("link", { name: "Start a club" }).click();
    // Its own sign-up flow since u4 (e2e/start-club.open-signup.spec.ts).
    await expect(page).toHaveURL("/login/start");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send my code" }).click();
    await finishCodeSignIn(page, email);
    expect(sentTo(email).map((m) => m.kind)).toEqual(["sign-in"]);
    await nameYourself(page, "Ola", "S");
    await expect(page).toHaveURL("/new?start=1");

    const client = postgres(process.env.E2E_DATABASE_URL!);
    try {
      const rows = await drizzle(client, { schema }).select().from(schema.users).where(eq(schema.users.email, email));
      expect(rows).toHaveLength(1);
    } finally {
      await client.end();
    }
  });
});
