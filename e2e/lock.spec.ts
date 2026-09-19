import type { Page } from "@playwright/test";
import { CLUB_5_ID, DISPLAY_NAME_5 } from "../db/seed-fixtures";
import { collectConsoleErrors } from "./console-errors";
import { expect, test } from "./fixtures";

const CLUB_5_URL = `/clubs/${CLUB_5_ID}`;

async function pickIdentity(page: Page, name: string) {
  await page.goto(CLUB_5_URL);
  await page.getByRole("button", { name, exact: true }).click();
}

function checkbox(page: Page, filmTitle: string) {
  return page.getByRole("checkbox", { name: new RegExp(filmTitle) });
}

// Fifth Club (Zoe/Yara/Xavier, db/seed.ts) exists solely for this one
// full-loop test: nomination through lock through confirmation through
// rating, via a real "Close voting and set the pick" click rather than
// a pre-seeded winner. Its night is already past its scheduled time
// from the moment it's seeded, so it qualifies for confirmation the
// instant it locks — no need to fake the passage of time mid-test.
// Serial: every step is a one-way transition the next step builds on.
test.describe.configure({ mode: "serial" });

test.describe("lock", () => {
  test("Zoe nominates Blade Runner and Zodiac, opening the vote", async ({ page }) => {
    await pickIdentity(page, DISPLAY_NAME_5.zoe);
    await checkbox(page, "Blade Runner").check();
    await checkbox(page, "Zodiac").check();
    await page.getByRole("button", { name: "Open voting" }).click();
    await expect(page.getByRole("heading", { name: /nominated by Zoe/ })).toBeVisible();
  });

  test("Yara votes for Blade Runner, but doesn't see the close-voting button — she's not owner/admin", async ({
    page,
  }) => {
    await pickIdentity(page, DISPLAY_NAME_5.yara);
    await page
      .locator("li", { hasText: "Blade Runner" })
      .getByRole("button", { name: /Vote/ })
      .click();
    await expect(page.getByText(/Blade Runner.*— 1 vote/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Close voting and set the pick" }),
    ).not.toBeVisible();
  });

  test("Xavier also votes for Blade Runner", async ({ page }) => {
    await pickIdentity(page, DISPLAY_NAME_5.xavier);
    await page
      .locator("li", { hasText: "Blade Runner" })
      .getByRole("button", { name: /Vote/ })
      .click();
    await expect(page.getByText(/Blade Runner.*— 2 votes/)).toBeVisible();
  });

  test("Zoe (the nominator) votes for Zodiac instead", async ({ page }) => {
    await pickIdentity(page, DISPLAY_NAME_5.zoe);
    await page
      .locator("li", { hasText: "Zodiac" })
      .getByRole("button", { name: /Vote/ })
      .click();
    await expect(page.getByText(/Zodiac.*— 1 vote/)).toBeVisible();
  });

  // Xavier's context is opened before lock and deliberately never
  // reloaded until after Zoe closes voting from a separate context —
  // that's what makes the later "stale vote" click a real exercise of
  // castVote's post-lock guard, not just a UI affordance that vanished.
  // Playwright tears down the default `page` fixture between tests, so
  // this whole sequence has to live in one test, manually-managed
  // contexts, same pattern as voting-flow.spec.ts's two-browser-context
  // scenario — the fixtures.ts auto-fixture only covers the default
  // `page`, so each manual context needs its own console-error collector.
  //
  // Zoe closes voting, not Yara or Xavier — CLAUDE.md restricts this to
  // owner/admin, and Zoe is the only one of the three with either role
  // (she's the club's owner).
  test("Zoe closes voting while Xavier's stale page still shows the vote; his late vote is silently rejected", async ({
    browser,
  }) => {
    const xavierContext = await browser.newContext();
    const zoeContext = await browser.newContext();
    try {
      const xavierPage = await xavierContext.newPage();
      const zoePage = await zoeContext.newPage();
      const xavierErrors = collectConsoleErrors(xavierPage);
      const zoeErrors = collectConsoleErrors(zoePage);

      await pickIdentity(xavierPage, DISPLAY_NAME_5.xavier);
      await expect(xavierPage.getByText(/Blade Runner.*— 2 votes/)).toBeVisible();

      await pickIdentity(zoePage, DISPLAY_NAME_5.zoe);
      await zoePage.getByRole("button", { name: "Close voting and set the pick" }).click();
      await expect(
        zoePage.getByRole("heading", { name: "Did you watch Blade Runner?" }),
      ).toBeVisible();
      // The losing nominee never gets its own UI decision moment — the
      // whole nominee list disappears once locked, same as the "no open
      // vote" fallback for any other non-open state.
      await expect(zoePage.getByText("Zodiac")).not.toBeVisible();

      // Xavier's page was never reloaded — its DOM still has Zodiac's
      // vote button rendered, even though the night is now locked
      // server-side. Clicking it exercises castVote's post-lock guard.
      await xavierPage
        .locator("li", { hasText: "Zodiac" })
        .getByRole("button", { name: /Vote/ })
        .click();
      await xavierPage.reload();
      await expect(xavierPage.getByText("Zodiac")).not.toBeVisible();
      // The locked winner is unchanged by the late vote attempt.
      await expect(
        xavierPage.getByRole("heading", { name: "Did you watch Blade Runner?" }),
      ).toBeVisible();

      expect(xavierErrors, `Xavier's console:\n\n${xavierErrors.join("\n\n")}`).toEqual([]);
      expect(zoeErrors, `Zoe's console:\n\n${zoeErrors.join("\n\n")}`).toEqual([]);
    } finally {
      await xavierContext.close();
      await zoeContext.close();
    }
  });

  test("RSVP still works after lock — it just doesn't touch the pick", async ({ page }) => {
    await pickIdentity(page, DISPLAY_NAME_5.xavier);
    await page.getByRole("button", { name: "Not going" }).click();
    await expect(page.getByText("Current answer: no")).toBeVisible();
    // The confirmation prompt still names the same locked winner —
    // an RSVP change after lock has no effect on the pick.
    await expect(
      page.getByRole("heading", { name: "Did you watch Blade Runner?" }),
    ).toBeVisible();
  });

  test("Zoe confirms it watched, closing the loop into the rating screen", async ({ page }) => {
    await pickIdentity(page, DISPLAY_NAME_5.zoe);
    await page.getByRole("button", { name: "Yes", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Rate Blade Runner" })).toBeVisible();
  });
});
