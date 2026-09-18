import type { BrowserContext, Page } from "@playwright/test";
import { collectConsoleErrors } from "./console-errors";
import { expect, test } from "./fixtures";

// Every other spec runs against clubs db/seed.ts pre-populates. This one
// is different on purpose — the whole point of this feature is that a
// club no longer needs hand-seeding, so the test creates its own club
// live via /new and never touches seed-fixtures.ts. Manually-managed
// browser contexts throughout (not the default `page`) since several
// distinct people need independent cookies within one test — same
// pattern as voting-flow.spec.ts's two-browser-context scenario.
test.describe("club creation and invites", () => {
  test("create, invite, join, see each other, and the seventh member is refused", async ({
    browser,
  }) => {
    const contexts: BrowserContext[] = [];
    const newContext = async () => {
      const ctx = await browser.newContext();
      contexts.push(ctx);
      return ctx;
    };

    try {
      // --- Robin creates the club and lands in it as owner. ---
      const ownerContext = await newContext();
      const ownerPage = await ownerContext.newPage();
      const ownerErrors = collectConsoleErrors(ownerPage);

      await ownerPage.goto("/new");
      await ownerPage.getByLabel("Club name").fill("E2E Test Club");
      await ownerPage.getByLabel("Your name").fill("Robin");
      await ownerPage.getByLabel("Timezone").fill("America/New_York");
      await ownerPage.getByRole("button", { name: "Create club" }).click();

      await expect(ownerPage).toHaveURL(/\/clubs\/[0-9a-f-]{36}$/);
      const clubUrl = ownerPage.url();
      const joinUrl = `${clubUrl}/join`;

      await expect(ownerPage.getByText("You are: Robin")).toBeVisible();
      await expect(ownerPage.locator('h2:has-text("Members") + p')).toHaveText("Robin");

      // --- A second person joins via the invite link, under a new name. ---
      const friendContext = await newContext();
      const friendPage = await friendContext.newPage();
      const friendErrors = collectConsoleErrors(friendPage);

      await friendPage.goto(joinUrl);
      await expect(friendPage.getByRole("heading", { name: "E2E Test Club" })).toBeVisible();
      await expect(friendPage.locator('h2:has-text("Who\'s in") + p')).toHaveText("Robin");
      await friendPage.getByLabel("Your name").fill("Sam");
      await friendPage.getByRole("button", { name: "Join" }).click();

      await expect(friendPage).toHaveURL(clubUrl);
      await expect(friendPage.getByText("You are: Sam")).toBeVisible();

      // --- Both now see each other in the member list. ---
      await ownerPage.reload();
      await expect(ownerPage.locator('h2:has-text("Members") + p')).toHaveText("Robin, Sam");
      await expect(friendPage.locator('h2:has-text("Members") + p')).toHaveText("Robin, Sam");

      expect(ownerErrors, `Robin's console:\n\n${ownerErrors.join("\n\n")}`).toEqual([]);
      expect(friendErrors, `Sam's console:\n\n${friendErrors.join("\n\n")}`).toEqual([]);

      // --- Fill the club to the free-tier cap of six (Robin, Sam + 4). ---
      for (const name of ["Ann", "Bo", "Cid", "Dee"]) {
        const ctx = await newContext();
        const page = await ctx.newPage();
        await joinAsNewMember(page, joinUrl, name);
        await expect(page).toHaveURL(clubUrl);
      }

      // --- A seventh member is refused with a clear, visible message. ---
      const seventhContext = await newContext();
      const seventhPage = await seventhContext.newPage();
      const seventhErrors = collectConsoleErrors(seventhPage);

      await seventhPage.goto(joinUrl);
      await seventhPage.getByLabel("Your name").fill("Zed");
      await seventhPage.getByRole("button", { name: "Join" }).click();

      // Refused, not silently dropped: still on /join (never reached the
      // club), with the free-tier limit named in a visible message.
      await expect(seventhPage).toHaveURL(new RegExp(`${joinUrl}\\?error=`));
      await expect(seventhPage.getByText(/free-tier limit of 6 members/)).toBeVisible();
      await expect(seventhPage.getByText("You are: Zed")).not.toBeVisible();

      expect(seventhErrors, `Zed's console:\n\n${seventhErrors.join("\n\n")}`).toEqual([]);
    } finally {
      await Promise.all(contexts.map((ctx) => ctx.close()));
    }
  });
});

async function joinAsNewMember(page: Page, joinUrl: string, name: string) {
  await page.goto(joinUrl);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
}
