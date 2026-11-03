import type { BrowserContext } from "@playwright/test";
import { collectConsoleErrors } from "./console-errors";
import { expect, test } from "./fixtures";
import { finishCodeSignIn, nameYourself } from "./signIn";

// Every other spec runs against clubs db/seed.ts pre-populates. This one
// creates its own club live — the point is that a club needs no
// hand-seeding. Separate browser contexts throughout, one per person.
test.describe("club creation and invites", () => {
  test("sign up, create, invite, join, see each other — and invites stop at the free-tier cap", async ({
    browser,
  }) => {
    const contexts: BrowserContext[] = [];
    const newPage = async () => {
      const ctx = await browser.newContext();
      contexts.push(ctx);
      const page = await ctx.newPage();
      return { page, errors: collectConsoleErrors(page) };
    };

    try {
      // --- Robin signs up and creates the club, landing in it as owner. ---
      const owner = await newPage();
      await owner.page.goto("/new");
      await owner.page.getByLabel("Email").fill("robin.creates@example.com");
      await owner.page.getByRole("button", { name: "Send code" }).click();
      await finishCodeSignIn(owner.page, "robin.creates@example.com");
      await nameYourself(owner.page, "Robin", "B");
      await owner.page.getByLabel("Club name").fill("E2E Test Club");
      await owner.page.getByLabel("Timezone").fill("America/New_York");
      await owner.page.getByRole("button", { name: "Create club" }).click();

      await expect(owner.page).toHaveURL(/\/clubs\/[0-9a-f-]{36}$/);
      const clubUrl = owner.page.url();
      await expect(owner.page.getByText("You are: Robin B.")).toBeVisible();
      await expect(owner.page.locator('h2:has-text("Members") + p')).toHaveText("Robin B.");
      await expect(owner.page.getByText("1 of 6 seats.")).toBeVisible();

      // --- Robin invites Sam; Sam joins with that link. ---
      await owner.page.getByLabel("First name").fill("Sam");
      await owner.page.getByLabel("Last initial").fill("K");
      await owner.page.getByRole("button", { name: "Create invite" }).click();
      const samLink = await owner.page.getByLabel("Invite link for Sam K.").inputValue();

      const friend = await newPage();
      await friend.page.goto(samLink);
      await friend.page.getByLabel("Your email").fill("sam.joins@example.com");
      await friend.page.getByRole("button", { name: "Continue" }).click();
      await finishCodeSignIn(friend.page, "sam.joins@example.com");
      await nameYourself(friend.page, "Sam", "K");
      await expect(friend.page).toHaveURL(new RegExp(`${clubUrl}\\?joined=1`));
      await expect(friend.page.getByText("You are: Sam K.")).toBeVisible();

      // --- Both now see each other. ---
      await owner.page.goto(clubUrl);
      await expect(owner.page.locator('h2:has-text("Members") + p')).toHaveText("Robin B., Sam K.");
      await expect(friend.page.locator('h2:has-text("Members") + p')).toHaveText("Robin B., Sam K.");

      // --- Pending invites hold seats: four more fill the club to six. ---
      for (const [first, initial] of [
        ["Ann", "O"],
        ["Bo", "L"],
        ["Cid", "M"],
        ["Dee", "N"],
      ] as const) {
        await owner.page.getByLabel("First name").fill(first);
        await owner.page.getByLabel("Last initial").fill(initial);
        await owner.page.getByRole("button", { name: "Create invite" }).click();
        await expect(owner.page.getByLabel(`Invite link for ${first} ${initial}.`)).toBeVisible();
      }

      // --- The seventh isn't offered, and the page says why. ---
      await expect(owner.page.getByText("6 of 6 seats.")).toBeVisible();
      await expect(owner.page.getByRole("button", { name: "Create invite" })).toHaveCount(0);
      await expect(
        owner.page.getByText("E2E Test Club is full: 2 members and 4 pending invites."),
      ).toBeVisible();

      expect(owner.errors).toEqual([]);
      expect(friend.errors).toEqual([]);
    } finally {
      await Promise.all(contexts.map((ctx) => ctx.close()));
    }
  });
});
