import type { Page } from "@playwright/test";
import { CLUB_ID, MEMBERSHIP, MEMBERSHIP_SEEN, SEEN_CLUB, SEEN_CLUB_NAME } from "../db/seed-fixtures";
import { expect, test } from "./fixtures";
import { signInAs } from "./session";
import { finishCodeSignIn, nameYourself } from "./signIn";

// The global /watchlist (docs/onboarding-spec.md §6.4, §6.2, §5.11.2;
// rebuild step 6c). Sky is in Apple Club and Birch Club
// (db/seed-fixtures.ts SEEN_CLUB): seen from Apple, Hereditary and Zodiac
// are on three lists and Apple watched Thief; seen from Birch, only Ben's
// Whiplash overlaps. Dana is in one club. A fresh account has none.
test.describe.configure({ mode: "serial" });

const PRIVACY = "Your clubs can see which films you've added, one film at a time, never your whole list.";
const APPLE = SEEN_CLUB_NAME.apple;
const BIRCH = SEEN_CLUB_NAME.birch;

async function search(page: Page, query: string) {
  await page.getByPlaceholder("Search films").fill(query);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("heading", { name: `Results for "${query}"` })).toBeVisible();
}

const result = (page: Page, title: string) => page.locator("li.result", { hasText: title });
const tile = (page: Page, title: string) => page.locator(".watchlist-item", { hasText: title });
const chips = (page: Page) => page.locator("form.seen-from button");
const pressed = (page: Page) => page.locator('form.seen-from button[aria-pressed="true"]');
const everyoneWants = (page: Page) => page.getByRole("heading", { name: /^Everyone wants these/ });

// Global level: Watchlist current, no club header or tabs, no rail, and the
// privacy line under the heading.
async function expectGlobalPage(page: Page) {
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Watchlist" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("heading", { level: 1, name: "Your watchlist" })).toBeVisible();
  await expect(page.getByText(PRIVACY, { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Club" })).toHaveCount(0);
  await expect(page.getByRole("complementary")).toHaveCount(0);
  await expect(page.locator(".rail")).toHaveCount(0);
}

test.describe("global watchlist", () => {
  test("empty list, no clubs: the empty state, search focused, the hint, no chips", async ({ page }) => {
    const email = "global-watchlist@example.com";
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send code" }).click();
    await finishCodeSignIn(page, email);
    await nameYourself(page, "Gil", "W");
    await expect(page).toHaveURL("/");

    await page.goto("/watchlist");
    await expectGlobalPage(page);
    await expect(page.getByText("Your list is empty.")).toBeVisible();
    await expect(page.getByText("Try heat, or a director.")).toBeVisible();
    await expect(page.getByPlaceholder("Search films")).toBeFocused();
    await expect(chips(page)).toHaveCount(0);

    // Films, no clubs: shelves and a total, but nothing seen from a club —
    // no overlap badge (Priya and Marco want Hereditary, elsewhere), no
    // "already watched", no smart shelf.
    await search(page, "Hereditary");
    await expect(result(page, "Hereditary").locator(".overlap-badge, .watched-badge")).toHaveCount(0);
    await result(page, "Hereditary").getByRole("button", { name: "Add" }).click();
    await expect(tile(page, "Hereditary")).toHaveCount(1);
    await expect(page.getByText(/^1 films · /)).toBeVisible();
    await expect(everyoneWants(page)).toHaveCount(0);
    await expect(page.getByText("Your list is empty.")).toHaveCount(0);
    await expectGlobalPage(page);
  });

  test("one club: badges seen from it, implicitly, no chips", async ({ page }) => {
    await signInAs(page, MEMBERSHIP.dana);
    await page.goto("/watchlist");
    await expectGlobalPage(page);
    await expect(chips(page)).toHaveCount(0);
    await search(page, "Hereditary");
    await expect(result(page, "Hereditary").locator(".overlap-badge")).toHaveText(
      "2 others in Movie Night Crew want this",
    );
    await search(page, "Thief");
    await expect(result(page, "Thief").locator(".watched-badge")).toHaveText("Movie Night Crew watched this");
  });

  test("several clubs: chips switch the badges and shelves; the choice survives a reload; ?seen= presets one visit", async ({
    page,
  }) => {
    await signInAs(page, MEMBERSHIP_SEEN.skyApple);
    await page.goto("/watchlist");
    await expectGlobalPage(page);
    await expect(chips(page)).toHaveText([APPLE, BIRCH]);
    await expect(page.locator("form.seen-from")).toContainText("Seen from:");
    // Default: the first club by name.
    await expect(pressed(page)).toHaveText(APPLE);
    await expect(everyoneWants(page)).toHaveText("Everyone wants these (2)");
    await search(page, "Hereditary");
    await expect(result(page, "Hereditary").locator(".overlap-badge")).toHaveText("2 others in Apple Club want this");

    await page.getByRole("button", { name: BIRCH }).click();
    await expect(page).toHaveURL("/watchlist");
    await expect(pressed(page)).toHaveText(BIRCH);
    await expect(everyoneWants(page)).toHaveCount(0);
    await search(page, "Whiplash");
    await expect(result(page, "Whiplash").locator(".overlap-badge")).toHaveText("1 other in Birch Club wants this");
    await search(page, "Hereditary");
    await expect(result(page, "Hereditary").locator(".overlap-badge")).toHaveCount(0);
    await search(page, "Thief");
    await expect(result(page, "Thief").locator(".watched-badge")).toHaveCount(0);

    // Saved in the cookie.
    await page.goto("/watchlist");
    await page.reload();
    await expect(pressed(page)).toHaveText(BIRCH);

    // ?seen= from a club presets that visit only…
    await page.goto(`/watchlist?seen=${SEEN_CLUB.apple}`);
    await expect(pressed(page)).toHaveText(APPLE);
    await expect(everyoneWants(page)).toHaveText("Everyone wants these (2)");
    await search(page, "Thief");
    await expect(result(page, "Thief").locator(".watched-badge")).toHaveText("Apple Club watched this");
    // …and never overwrites the saved choice.
    await page.goto("/watchlist");
    await expect(pressed(page)).toHaveText(BIRCH);
  });

  test("a ?seen= or forged cookie for a club you're not in is ignored: no 404, nothing from that club", async ({
    page,
    baseURL,
  }) => {
    await signInAs(page, MEMBERSHIP_SEEN.skyApple);
    // Movie Night Crew, which Sky isn't in.
    await page.context().addCookies([
      { name: "kinomato_seen_from", value: CLUB_ID, url: `${baseURL}/watchlist` },
    ]);
    for (const url of ["/watchlist", `/watchlist?seen=${CLUB_ID}`]) {
      const response = await page.goto(url);
      expect(response?.status()).toBe(200);
      // Treated as unset: the default club, Apple, exactly as with no choice.
      await expect(pressed(page)).toHaveText(APPLE);
      await expect(everyoneWants(page)).toHaveText("Everyone wants these (2)");
      await expect(page.getByText("Movie Night Crew")).toHaveCount(0);
    }
    await search(page, "Hereditary");
    await expect(result(page, "Hereditary").locator(".overlap-badge")).toHaveText("2 others in Apple Club want this");
    await expect(page.getByText("Movie Night Crew")).toHaveCount(0);
  });

  test("add and remove on /watchlist show on the club list pages, and the other way round", async ({ page }) => {
    await signInAs(page, MEMBERSHIP_SEEN.skyApple);
    await page.goto("/watchlist");
    await search(page, "Arrival");
    await result(page, "Arrival").getByRole("button", { name: "Add" }).click();
    await expect(tile(page, "Arrival")).toHaveCount(1);
    await page.goto(`/clubs/${SEEN_CLUB.apple}/list`);
    await expect(tile(page, "Arrival")).toHaveCount(1);

    await page.goto(`/clubs/${SEEN_CLUB.birch}/list`);
    await tile(page, "Arrival").getByRole("button", { name: "Remove" }).click();
    await expect(tile(page, "Arrival")).toHaveCount(0);
    await page.goto("/watchlist");
    await expect(tile(page, "Arrival")).toHaveCount(0);

    await page.goto(`/clubs/${SEEN_CLUB.birch}/list`);
    await page.getByPlaceholder("Search films").fill("Blade Runner");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.locator("li", { hasText: "Blade Runner" }).getByRole("button", { name: "Add" }).click();
    await expect(tile(page, "Blade Runner")).toHaveCount(1);
    await page.goto("/watchlist");
    await expect(tile(page, "Blade Runner")).toHaveCount(1);
    await tile(page, "Blade Runner").getByRole("button", { name: "Remove" }).click();
    await expect(tile(page, "Blade Runner")).toHaveCount(0);
    await page.goto(`/clubs/${SEEN_CLUB.apple}/list`);
    await expect(tile(page, "Blade Runner")).toHaveCount(0);
  });
});
