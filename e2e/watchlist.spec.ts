import type { Page } from "@playwright/test";
import { CLUB_ID } from "../db/seed-fixtures";
import { expect, test } from "./fixtures";

const LIST_URL = `/clubs/${CLUB_ID}/list`;

async function pickIdentity(page: Page, name: string) {
  await page.goto(LIST_URL);
  await page.getByRole("button", { name, exact: true }).click();
}

async function search(page: Page, query: string) {
  await page.getByPlaceholder("Search films").fill(query);
  await page.getByRole("button", { name: "Search", exact: true }).click();
}

function resultRow(page: Page, filmTitle: string) {
  return page.locator("li", { hasText: filmTitle });
}

// Dana's seeded watchlist (db/seed.ts): The Babadook + Get Out (a real,
// 2-film Horror shelf) + Arrival (a singleton, in Everything else).
// Hereditary is seeded on Priya's and Marco's lists, not Dana's — used
// here for the overlap-badge and add-to-shelf scenarios. These tests are
// serial and build on each other in this exact order.
test.describe.configure({ mode: "serial" });

test.describe("watchlist", () => {
  test("searching finds a film", async ({ page }) => {
    await pickIdentity(page, "Dana");
    await search(page, "Whiplash");
    await expect(resultRow(page, "Whiplash")).toBeVisible();
  });

  test("the overlap badge shows the right count against seeded data", async ({ page }) => {
    await pickIdentity(page, "Dana");
    await search(page, "Hereditary");
    // Priya and Marco have it, Dana doesn't yet — "2 others", not 3.
    await expect(resultRow(page, "Hereditary")).toContainText(
      "2 others in your club want this",
    );
  });

  test("adding it puts it on a genre shelf", async ({ page }) => {
    await pickIdentity(page, "Dana");
    await search(page, "Hereditary");
    await resultRow(page, "Hereditary").getByRole("button", { name: "Add" }).click();

    // Joins the existing 2-film Horror shelf (Babadook, Get Out) -> 3.
    const horrorShelf = page.getByRole("heading", { name: "Horror (3)", exact: true });
    await expect(horrorShelf).toBeVisible();
    const shelfSection = horrorShelf.locator("..");
    await expect(shelfSection.getByText("Hereditary")).toBeVisible();
    await expect(shelfSection.getByText("The Babadook")).toBeVisible();
    await expect(shelfSection.getByText("Get Out")).toBeVisible();
  });

  test("already-watched shows for a film in the club's history", async ({ page }) => {
    await pickIdentity(page, "Dana");
    await search(page, "Thief");
    await expect(resultRow(page, "Thief")).toContainText("Club already watched this");
  });

  test("removing takes it off the list", async ({ page }) => {
    await pickIdentity(page, "Dana");
    const arrivalTile = page.locator("div.w-24", { hasText: "Arrival" });
    await expect(arrivalTile).toBeVisible();
    await arrivalTile.getByRole("button", { name: "Remove" }).click();
    await expect(page.locator("div.w-24", { hasText: "Arrival" })).toHaveCount(0);
  });

  test("the header runtime total is correct", async ({ page }) => {
    await pickIdentity(page, "Dana");
    // Final list after the tests above: Babadook (94) + Get Out (104) +
    // Hereditary (127, added) = 325 minutes = 5h 25m. Arrival (116) was
    // removed in the previous test, so it isn't part of this sum.
    await expect(page.getByText("3 films · 5h 25m")).toBeVisible();
  });
});
