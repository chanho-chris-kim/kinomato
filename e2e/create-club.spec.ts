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
//
// Every name here is first name + last initial (CLAUDE.md's name-field
// ruling) — "Robin" alone is not a valid submission anymore, and the
// composed form ("Robin B.") is what buttons/text actually show.
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
      await ownerPage.getByLabel("First name").first().fill("Robin");
      await ownerPage.getByLabel("Last initial").first().fill("B");
      await ownerPage.getByLabel("Timezone").fill("America/New_York");
      await ownerPage.getByRole("button", { name: "Create club" }).click();

      await expect(ownerPage).toHaveURL(/\/clubs\/[0-9a-f-]{36}$/);
      const clubUrl = ownerPage.url();
      // Read the real invite link off the page rather than
      // constructing it — it carries a token now (CLAUDE.md), which
      // this test has no way to predict.
      const inviteHref = await ownerPage
        .locator('a[href*="/join?token="]')
        .getAttribute("href");
      const joinUrl = new URL(inviteHref!, clubUrl).toString();

      await expect(ownerPage.getByText("You are: Robin B.")).toBeVisible();
      await expect(ownerPage.locator('h2:has-text("Members") + p')).toHaveText("Robin B.");

      // --- A second person joins via the invite link, under a new name. ---
      const friendContext = await newContext();
      const friendPage = await friendContext.newPage();
      const friendErrors = collectConsoleErrors(friendPage);

      await friendPage.goto(joinUrl);
      await expect(friendPage.getByRole("heading", { name: "E2E Test Club" })).toBeVisible();
      await expect(friendPage.locator('h2:has-text("Who\'s in") + p')).toHaveText("Robin B.");
      await joinAsNewMember(friendPage, joinUrl, "Sam", "K");

      await expect(friendPage).toHaveURL(clubUrl);
      await expect(friendPage.getByText("You are: Sam K.")).toBeVisible();

      // --- Both now see each other in the member list. ---
      await ownerPage.reload();
      await expect(ownerPage.locator('h2:has-text("Members") + p')).toHaveText(
        "Robin B., Sam K.",
      );
      await expect(friendPage.locator('h2:has-text("Members") + p')).toHaveText(
        "Robin B., Sam K.",
      );

      expect(ownerErrors, `Robin's console:\n\n${ownerErrors.join("\n\n")}`).toEqual([]);
      expect(friendErrors, `Sam's console:\n\n${friendErrors.join("\n\n")}`).toEqual([]);

      // --- Fill the club to the free-tier cap of six (Robin, Sam + 4). ---
      for (const [firstName, lastInitial] of [
        ["Ann", "O"],
        ["Bo", "L"],
        ["Cid", "M"],
        ["Dee", "N"],
      ] as const) {
        const ctx = await newContext();
        const page = await ctx.newPage();
        await joinAsNewMember(page, joinUrl, firstName, lastInitial);
        await expect(page).toHaveURL(clubUrl);
      }

      // --- A seventh member is refused with a clear, visible message. ---
      const seventhContext = await newContext();
      const seventhPage = await seventhContext.newPage();
      const seventhErrors = collectConsoleErrors(seventhPage);

      await seventhPage.goto(joinUrl);
      await seventhPage.getByLabel("First name").fill("Zed");
      await seventhPage.getByLabel("Last initial").fill("Q");
      await seventhPage.getByRole("button", { name: "Join" }).click();

      // Refused, not silently dropped: still on /join (never reached the
      // club), with the free-tier limit named in a visible message.
      // Waits on the visible text first (auto-waiting for the redirect
      // to actually land) before reading page.url(), which — unlike
      // toHaveURL — doesn't wait on its own. URL checked via parts, not
      // a regex built from joinUrl directly — joinUrl now carries a
      // token (CLAUDE.md) full of characters (:, /, ?) that would need
      // escaping to use literally in a RegExp.
      await expect(seventhPage.getByText(/free-tier limit of 6 members/)).toBeVisible();
      const seventhUrl = new URL(seventhPage.url());
      expect(seventhUrl.pathname).toBe(new URL(joinUrl).pathname);
      expect(seventhUrl.searchParams.get("error")).toBeTruthy();
      await expect(seventhPage.getByText("You are: Zed Q.")).not.toBeVisible();

      expect(seventhErrors, `Zed's console:\n\n${seventhErrors.join("\n\n")}`).toEqual([]);
    } finally {
      await Promise.all(contexts.map((ctx) => ctx.close()));
    }
  });
});

async function joinAsNewMember(
  page: Page,
  joinUrl: string,
  firstName: string,
  lastInitial: string,
) {
  await page.goto(joinUrl);
  await page.getByLabel("First name").fill(firstName);
  await page.getByLabel("Last initial").fill(lastInitial);
  await page.getByRole("button", { name: "Join" }).click();
}
