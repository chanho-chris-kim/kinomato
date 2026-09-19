import { CLUB_ID, DISPLAY_NAME } from "../db/seed-fixtures";
import { expect, test } from "./fixtures";

const CLUB_URL = `/clubs/${CLUB_ID}`;
const LIST_URL = `${CLUB_URL}/list`;

// There was no way back from the watchlist before this (CLAUDE.md) —
// ClubNav is the fix, present on both club-scoped routes once someone
// has an identity, with whichever page you're on marked instead of
// linked.
test.describe("club nav", () => {
  test("the watchlist link on the club page goes to the watchlist, with it marked current there", async ({
    page,
  }) => {
    await page.goto(CLUB_URL);
    await page.getByRole("button", { name: DISPLAY_NAME.chris, exact: true }).click();

    await expect(page.getByRole("heading", { name: "Movie Night Crew" })).toBeVisible();
    // "Club" is the current page — plain text, not a link.
    await expect(page.getByRole("link", { name: "Club", exact: true })).not.toBeVisible();
    await expect(page.getByText("Club", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Watchlist", exact: true }).click();
    await expect(page).toHaveURL(LIST_URL);
    await expect(page.getByRole("heading", { name: "Movie Night Crew" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Watchlist", exact: true })).not.toBeVisible();
    await expect(page.getByText("Watchlist", { exact: true })).toBeVisible();
  });

  test("the club link on the watchlist page goes back to the club page — the fix itself", async ({
    page,
  }) => {
    await page.goto(LIST_URL);
    await page.getByRole("button", { name: DISPLAY_NAME.chris, exact: true }).click();
    await expect(page.getByRole("heading", { name: "Movie Night Crew" })).toBeVisible();

    await page.getByRole("link", { name: "Club", exact: true }).click();
    await expect(page).toHaveURL(CLUB_URL);
    await expect(page.getByText("Whose turn")).toBeVisible();
  });

  test("the club name itself also links home, from the watchlist", async ({ page }) => {
    await page.goto(LIST_URL);
    await page.getByRole("button", { name: DISPLAY_NAME.chris, exact: true }).click();

    await page.getByRole("link", { name: "Movie Night Crew" }).click();
    await expect(page).toHaveURL(CLUB_URL);
  });
});
