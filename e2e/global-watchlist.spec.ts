import type { Page } from "@playwright/test";
import {
  CLUB_8_ID,
  CLUB_ID,
  HOME_CLUB,
  MEMBERSHIP,
  MEMBERSHIP_8,
  MEMBERSHIP_HOME,
  MEMBERSHIP_SEEN,
  SEEN_CLUB,
  SEEN_CLUB_NAME,
} from "../db/seed-fixtures";
import { expect, test } from "./fixtures";
import { signInAs } from "./session";
import { existingAccount, finishCodeSignIn, nameYourself } from "./signIn";

// The global /watchlist (docs/onboarding-spec.md §6.4, §6.2, §5.11.2;
// rebuild step 6c; Seen from removed 2026-11-24). Sky is in Apple Club and
// Birch Club (db/seed-fixtures.ts SEEN_CLUB): in Apple, Hereditary and
// Zodiac are on three lists and Apple watched Thief; in Birch, only Ben's
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
// Seen from's old chip row, which must never come back.
const chips = (page: Page) => page.locator("form.seen-from, button[aria-pressed]");
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
  test("empty list, no clubs: the empty state, search focused, the hint, no badges", async ({ page }) => {
    const email = "global-watchlist@example.com";
    await existingAccount(email);
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send my code" }).click();
    await finishCodeSignIn(page, email);
    await nameYourself(page, "Gil", "W");
    await expect(page).toHaveURL("/");

    await page.goto("/watchlist");
    await expectGlobalPage(page);
    await expect(page.getByText("Your list is empty.")).toBeVisible();
    await expect(page.getByText("Try heat, or a director.")).toBeVisible();
    await expect(page.getByPlaceholder("Search films")).toBeFocused();
    await expect(chips(page)).toHaveCount(0);

    // Films, no clubs: shelves and a total, but no club badges —
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

  test("one club: badges name it", async ({ page }) => {
    await signInAs(page, MEMBERSHIP.dana);
    await page.goto("/watchlist");
    await expectGlobalPage(page);
    await expect(chips(page)).toHaveCount(0);
    await search(page, "Hereditary");
    await expect(result(page, "Hereditary").locator(".overlap-badge")).toHaveText("2 in Movie Night Crew want this");
    await search(page, "Thief");
    await expect(result(page, "Thief").locator(".watched-badge")).toHaveText("Movie Night Crew watched this");
  });

  test("several clubs: no Seen from; a badge per club where it applies, each naming its club", async ({ page }) => {
    await signInAs(page, MEMBERSHIP_SEEN.skyApple);
    await page.goto("/watchlist");
    await expectGlobalPage(page);
    await expect(chips(page)).toHaveCount(0);
    await expect(page.getByText("Seen from")).toHaveCount(0);
    // Hereditary and Zodiac are on three lists in Apple Club.
    await expect(everyoneWants(page)).toHaveText("Everyone wants these (2)");

    await search(page, "Hereditary");
    await expect(result(page, "Hereditary").locator(".overlap-badge")).toHaveText([`2 in ${APPLE} want this`]);
    await search(page, "Whiplash");
    await expect(result(page, "Whiplash").locator(".overlap-badge")).toHaveText([`1 in ${BIRCH} wants this`]);
    await search(page, "Thief");
    await expect(result(page, "Thief").locator(".watched-badge")).toHaveText([`${APPLE} watched this`]);
  });

  test("the retired Seen from cookie is deleted on a visit, and an old ?seen= link lands on /watchlist", async ({
    page,
    baseURL,
  }) => {
    await signInAs(page, MEMBERSHIP_SEEN.skyApple);
    const seenFromCookie = async () =>
      (await page.context().cookies(`${baseURL}/watchlist`)).filter((c) => c.name === "kinomato_seen_from");
    // As the app set it (path /watchlist), and on / for good measure.
    const { hostname } = new URL(baseURL!);
    for (const path of ["/watchlist", "/"]) {
      await page.context().addCookies([
        { name: "kinomato_seen_from", value: SEEN_CLUB.birch, domain: hostname, path, httpOnly: true, sameSite: "Lax" },
      ]);
      expect(await seenFromCookie()).toHaveLength(1);
      await page.goto("/watchlist");
      await expect(page).toHaveURL("/watchlist");
      await expectGlobalPage(page);
      expect(await seenFromCookie()).toEqual([]);
    }

    // A ?seen= link, for a club you're in or not: plain /watchlist, the
    // search kept, nothing set.
    for (const club of [SEEN_CLUB.apple, CLUB_ID]) {
      const response = await page.goto(`/watchlist?seen=${club}&q=heat`);
      expect(response?.status()).toBe(200);
      await expect(page).toHaveURL("/watchlist?q=heat");
      await expect(page.getByRole("heading", { name: 'Results for "heat"' })).toBeVisible();
      await expect(chips(page)).toHaveCount(0);
      await expect(page.getByText("Movie Night Crew")).toHaveCount(0);
      expect(await seenFromCookie()).toEqual([]);
    }
  });

  // Rebuild step 6d: the club-scoped list is retired; links into it, and
  // Tonight's nominate empty state, cross levels to /watchlist (§5.11.2).
  test("an old club list link lands on /watchlist, carrying ?q=", async ({ page }) => {
    await signInAs(page, MEMBERSHIP_SEEN.skyApple);
    await page.goto(`/clubs/${SEEN_CLUB.birch}/list?q=heat`);
    await expect(page).toHaveURL("/watchlist?q=heat");
    await expectGlobalPage(page);
    await expect(page.getByRole("heading", { name: 'Results for "heat"' })).toBeVisible();
  });

  test("Tonight's nominate empty state links to /watchlist", async ({ page }) => {
    // Kit picks in Tenth Club, has an empty list, and is in four clubs.
    await signInAs(page, MEMBERSHIP_HOME.kit.nominate);
    await page.goto(`/clubs/${HOME_CLUB.nominate}`);
    await page.getByRole("link", { name: "Add films to it" }).click();
    await expect(page).toHaveURL("/watchlist");
    await expectGlobalPage(page);
    await expect(chips(page)).toHaveCount(0);
    await expect(page.getByText("Your list is empty.")).toBeVisible();
  });

  test("…and for someone in one club, the same", async ({ page }) => {
    // Hana picks in Eighth Club, her only club, and has an empty list.
    await signInAs(page, MEMBERSHIP_8.hana);
    await page.goto(`/clubs/${CLUB_8_ID}`);
    await page.getByRole("link", { name: "Add films to it" }).click();
    await expect(page).toHaveURL("/watchlist");
    await expectGlobalPage(page);
  });
});
