import type { Page } from "@playwright/test";
import { CLUB_2_ID, DISPLAY_NAME_2 } from "../db/seed-fixtures";
import { expect, test } from "./fixtures";

const CLUB_URL = `/clubs/${CLUB_2_ID}`;

async function pickIdentity(page: Page, name: string) {
  await page.goto(CLUB_URL);
  await page.getByRole("button", { name, exact: true }).click();
}

function checkbox(page: Page, filmTitle: string) {
  return page.getByRole("checkbox", { name: new RegExp(filmTitle) });
}

// "Second Club" (db/seed.ts) exists solely so this suite has a club with
// exactly one night in flight — reusing "Movie Night Crew" would leave
// two nights simultaneously "open" once Nadia's opens, which the club
// page's single-open-night lookup can't disambiguate. Nadia's watchlist
// has four films — Hereditary, Blade Runner, Zodiac, Whiplash —
// deliberately one more than the default nomineesPerTurn (3), so the cap
// is actually exercised. Serial: opening voting is a one-way transition
// these tests build on in order.
test.describe.configure({ mode: "serial" });

test.describe("nomination", () => {
  test("the picker sees selectable tiles", async ({ page }) => {
    await pickIdentity(page, DISPLAY_NAME_2.nadia);
    await expect(page.getByRole("heading", { name: "Your turn to nominate" })).toBeVisible();
    await expect(checkbox(page, "Hereditary")).toBeVisible();
  });

  test("a non-picker doesn't see selectable tiles", async ({ page }) => {
    await pickIdentity(page, DISPLAY_NAME_2.omar);
    await expect(
      page.getByRole("heading", { name: "Your turn to nominate" }),
    ).not.toBeVisible();
    await expect(page.getByText("Waiting on Nadia to nominate.")).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
  });

  test("selection caps at the setting", async ({ page }) => {
    await pickIdentity(page, DISPLAY_NAME_2.nadia);
    await checkbox(page, "Hereditary").check();
    await checkbox(page, "Blade Runner").check();
    await checkbox(page, "Zodiac").check();
    // Default nomineesPerTurn is 3 (clubs.settings is unset for this
    // club) — a fourth film can't be selected without deselecting one.
    await expect(checkbox(page, "Whiplash")).toBeDisabled();
  });

  test("opening voting creates exactly the selected nominations and the voting UI appears", async ({
    page,
  }) => {
    await pickIdentity(page, DISPLAY_NAME_2.nadia);
    await checkbox(page, "Hereditary").check();
    await checkbox(page, "Blade Runner").check();
    await checkbox(page, "Zodiac").check();
    await page.getByRole("button", { name: "Open voting" }).click();

    await expect(page.getByRole("heading", { name: /nominated by Nadia/ })).toBeVisible();
    await expect(page.getByText("Hereditary (2018) — 0 votes")).toBeVisible();
    await expect(page.getByText(/Blade Runner \(1982\) — 0 votes/)).toBeVisible();
    await expect(page.getByText("Zodiac (2007) — 0 votes")).toBeVisible();
    // Whiplash was on Nadia's watchlist too, but never selected — must
    // not appear as a nominee.
    await expect(page.getByText(/Whiplash/)).not.toBeVisible();
    // The nomination UI is gone now that this night has moved to open.
    await expect(page.getByRole("heading", { name: "Your turn to nominate" })).not.toBeVisible();
  });

  test("a second member then sees those nominees and can vote on them", async ({ page }) => {
    await pickIdentity(page, DISPLAY_NAME_2.omar);
    await expect(page.getByText("Hereditary (2018) — 0 votes")).toBeVisible();

    await page
      .locator("li", { hasText: "Hereditary" })
      .getByRole("button", { name: /Vote/ })
      .click();

    await expect(page.getByText("Hereditary (2018) — 1 vote")).toBeVisible();
  });
});
