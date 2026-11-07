import type { Page } from "@playwright/test";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import { DISPLAY_NAME_HISTORY, HISTORY_CLUB_ID, MEMBER_USER, MEMBERSHIP_HISTORY } from "../db/seed-fixtures";
import { expect, test } from "./fixtures";
import { signInAs } from "./session";

// Settings (docs/onboarding-spec.md §5.9; rebuild step 7a): your name, and
// Sign out everywhere. Rae, in the seeded History Club, is renamed: her
// name shows there as picker, attendee and rater. This club's Tonight is
// never opened (it would lazily create a draft night); its History page
// carries the rail. Her seeded name is put back afterwards.
test.describe.configure({ mode: "serial" });

const HISTORY_URL = `/clubs/${HISTORY_CLUB_ID}/history`;
const RAE = DISPLAY_NAME_HISTORY.rae; // "Rae D."

async function withDb<T>(fn: (db: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>): Promise<T> {
  const client = postgres(process.env.E2E_DATABASE_URL!);
  try {
    return await fn(drizzle(client, { schema }));
  } finally {
    await client.end();
  }
}

const nameOf = (userId: string) =>
  withDb(async (db) => (await db.select().from(schema.users).where(eq(schema.users.id, userId)))[0].displayName);

async function saveName(page: Page, first: string, initial: string) {
  await page.getByLabel("First name").fill(first);
  await page.getByLabel("Last initial").fill(initial);
  await page.getByRole("button", { name: "Save name" }).click();
}

test.describe("settings", () => {
  test.afterAll(async () => {
    await withDb((db) =>
      db.update(schema.users).set({ displayName: RAE }).where(eq(schema.users.id, MEMBER_USER.rae)),
    );
  });

  test("a rename shows on /, Members, the rail and History, past nights included", async ({ page }) => {
    await signInAs(page, MEMBERSHIP_HISTORY.rae);
    await page.goto("/settings");
    await expect(page.getByLabel("First name")).toHaveValue("Rae");
    await expect(page.getByLabel("Last initial")).toHaveValue("D");

    await saveName(page, "Raya", "q");
    await expect(page).toHaveURL("/settings?saved=name");
    await expect(page.locator("main").getByRole("status")).toHaveText("Saved.");
    await expect(page.getByLabel("First name")).toHaveValue("Raya");
    await expect(page.getByLabel("Last initial")).toHaveValue("Q");
    expect(await nameOf(MEMBER_USER.rae)).toBe("Raya Q.");

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hi, Raya");

    await page.goto(`/clubs/${HISTORY_CLUB_ID}/members`);
    await expect(page.locator("main .member-name").filter({ hasText: "(you)" })).toHaveText(["Raya Q. (you)"]);

    await page.goto(HISTORY_URL);
    await expect(
      page.getByRole("complementary", { name: "Club context" }).getByText("Raya Q. (you)", { exact: true }),
    ).toBeVisible();
    // Retroactive (§5.9 ruling): her pick, her attendance and her rating on
    // nights long past all read the new name, and the old one is gone.
    const night = page.locator("main li.history-night").filter({ has: page.getByRole("heading", { name: /^Blade Runner/ }) });
    await expect(night).toContainText("Raya Q.'s pick");
    await expect(night).toContainText("Came: Raya Q.");
    await expect(night.locator(".rating", { hasText: "Raya Q." })).toHaveCount(1);
    await expect(page.locator("main")).not.toContainText(RAE);
  });

  test("bad input shows the message and changes nothing", async ({ page }) => {
    await signInAs(page, MEMBERSHIP_HISTORY.rae);
    await page.goto("/settings");
    const before = await nameOf(MEMBER_USER.rae);
    await saveName(page, "Ray", "7");
    await expect(page).toHaveURL(/\/settings\?error=/);
    await expect(page.locator("main").getByRole("alert")).toHaveText("Last initial must be exactly one letter.");
    await expect(page.locator("main").getByRole("status")).toHaveCount(0);
    // What was typed stays in the form to fix.
    await expect(page.getByLabel("First name")).toHaveValue("Ray");
    await expect(page.getByLabel("Last initial")).toHaveValue("7");
    expect(await nameOf(MEMBER_USER.rae)).toBe(before);
  });

  test("Sign out everywhere signs out every browser, leaves no session, and lands here on /", async ({ browser }) => {
    const here = await browser.newContext();
    const there = await browser.newContext();
    try {
      const a = await here.newPage();
      const b = await there.newPage();
      await signInAs(a, MEMBERSHIP_HISTORY.sol);
      await signInAs(b, MEMBERSHIP_HISTORY.sol);
      await b.goto("/settings");
      await expect(b.getByRole("heading", { name: "Settings" })).toBeVisible();
      const sessions = () =>
        withDb(async (db) => (await db.select({ n: count() }).from(schema.sessions).where(eq(schema.sessions.userId, MEMBER_USER.sol)))[0].n);
      expect(await sessions()).toBeGreaterThanOrEqual(2);

      await a.goto("/settings");
      await a.getByRole("button", { name: "Sign out everywhere" }).click();
      await expect(a).toHaveURL("/");
      // Signed out here: the marketing page, not the club cards.
      await expect(a.getByRole("heading", { level: 1, name: "Whose turn is it?" })).toBeVisible();
      expect(await sessions()).toBe(0);

      // And there: the other browser's next request is signed out.
      await b.reload();
      await expect(b).toHaveURL(`/login?${new URLSearchParams({ returnTo: "/settings" })}`);
    } finally {
      await here.close();
      await there.close();
    }
  });
});
