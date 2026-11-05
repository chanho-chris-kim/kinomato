import type { Page } from "@playwright/test";
import { CLUB_ID, MEMBERSHIP } from "../db/seed-fixtures";
import { expect, test } from "./fixtures";
import { signInAs } from "./session";
import { finishCodeSignIn, nameYourself } from "./signIn";

// The global shell (docs/onboarding-spec.md §5.11, Ruling D; rebuild step
// 5a). Desktop Chrome's viewport is 1280px wide, so the top bar carries the
// global nav; the phone test resizes to see the bottom tab bar instead.
// Only the visible nav is ever exposed to role queries.
const CLUB_URL = `/clubs/${CLUB_ID}`;

function nav(page: Page) {
  return page.getByRole("navigation", { name: "Main" });
}

// A fresh account, named, signed in through the real code flow: for the
// watchlist cases, so no seeded club's membership changes.
async function signUp(page: Page, email: string, first: string, initial: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await finishCodeSignIn(page, email);
  await nameYourself(page, first, initial);
}

// Runs `act` and asserts it was a client-side navigation: a marker set on
// window beforehand survives only if no new document was loaded, and no
// document request goes out.
async function expectClientSideNavigation(page: Page, act: () => Promise<void>, url: string | RegExp) {
  const documents: string[] = [];
  const onRequest = (r: { resourceType(): string; url(): string }) => {
    if (r.resourceType() === "document") documents.push(r.url());
  };
  await page.evaluate(() => {
    (window as unknown as { __noReload?: boolean }).__noReload = true;
  });
  page.on("request", onRequest);
  await act();
  await expect(page).toHaveURL(url);
  page.off("request", onRequest);
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
  expect(documents).toEqual([]);
}

async function createClub(page: Page, name: string) {
  await page.goto("/new");
  await page.getByLabel("Club name").fill(name);
  await page.getByLabel("Timezone").fill("America/New_York");
  await page.getByRole("button", { name: "Create club" }).click();
  await expect(page).toHaveURL(/\/clubs\/[0-9a-f-]{36}$/);
  return page.url();
}

test.describe("global shell", () => {
  test("the wordmark links to / from a signed-in screen and a signed-out one", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Kinomato" }).click();
    await expect(page).toHaveURL("/");
    // Signed out: no global nav at all.
    await expect(nav(page)).toHaveCount(0);

    await signInAs(page, MEMBERSHIP.dana);
    await page.goto(CLUB_URL);
    await page.getByRole("link", { name: "Kinomato" }).click();
    await expect(page).toHaveURL("/");
  });

  test("Clubs is current on / and inside a club; Watchlist on the club's list", async ({ page }) => {
    await signInAs(page, MEMBERSHIP.dana);
    for (const url of ["/", CLUB_URL]) {
      await page.goto(url);
      await expect(nav(page).getByRole("link", { name: "Clubs" })).toHaveAttribute("aria-current", "page");
      await expect(nav(page).getByRole("link", { name: "Watchlist" })).not.toHaveAttribute("aria-current");
    }
    // The club header: name and schedule, the name linking to the club.
    await expect(page.getByRole("heading", { name: "Movie Night Crew" })).toBeVisible();
    await expect(page.getByText("Weekly, Saturdays at 8pm · In person")).toBeVisible();

    await page.goto(`${CLUB_URL}/list`);
    await expect(nav(page).getByRole("link", { name: "Watchlist" })).toHaveAttribute("aria-current", "page");
    await expect(nav(page).getByRole("link", { name: "Clubs" })).not.toHaveAttribute("aria-current");
    await page.getByRole("link", { name: "Movie Night Crew" }).click();
    await expect(page).toHaveURL(CLUB_URL);
  });

  test("on a phone the same three entries sit in a bottom tab bar", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await signInAs(page, MEMBERSHIP.dana);
    await page.goto(CLUB_URL);
    const bar = nav(page);
    await expect(bar).toHaveClass(/tabbar/);
    await expect(bar.getByRole("link")).toHaveText(["Clubs", "Watchlist", "Settings"]);
    await expect(bar.getByRole("link", { name: "Clubs" })).toHaveAttribute("aria-current", "page");
  });

  test("Watchlist with one club goes straight to that club's list", async ({ page }) => {
    await signInAs(page, MEMBERSHIP.dana);
    await page.goto("/");
    await nav(page).getByRole("link", { name: "Watchlist" }).click();
    await expect(page).toHaveURL(`${CLUB_URL}/list`);
  });

  test("clicking Watchlist, and searching the list, never reload the page", async ({ page }) => {
    await signInAs(page, MEMBERSHIP.dana);
    await page.goto(CLUB_URL);
    await expectClientSideNavigation(
      page,
      () => nav(page).getByRole("link", { name: "Watchlist" }).click(),
      `${CLUB_URL}/list`,
    );
    await expect(page.getByPlaceholder("Search films")).toBeVisible();
    // The search box was a plain GET <form>: every search was a full load.
    await expectClientSideNavigation(
      page,
      async () => {
        await page.getByPlaceholder("Search films").fill("Arrival");
        await page.getByRole("button", { name: "Search", exact: true }).click();
      },
      `${CLUB_URL}/list?q=Arrival`,
    );
    await expect(page.getByRole("heading", { name: 'Results for "Arrival"' })).toBeVisible();
  });

  test("Watchlist with no clubs explains itself; with several it lists them by name", async ({ page }) => {
    await signUp(page, "nav-watchlist@example.com", "Wren", "T");

    await page.goto("/watchlist");
    await expect(nav(page).getByRole("link", { name: "Watchlist" })).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByText(
        "Your watchlist lives in your clubs for now. Start a club, or join one with the invite link a friend sends you.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Start a club" })).toHaveAttribute("href", "/new");

    const second = await createClub(page, "Nav Club B");
    const first = await createClub(page, "Nav Club A");
    await page.goto("/watchlist");
    const links = page.locator('main a[href$="/list"]');
    await expect(links).toHaveText(["Nav Club A", "Nav Club B"]);
    await expect(links.nth(0)).toHaveAttribute("href", `${new URL(first).pathname}/list`);
    await expect(links.nth(1)).toHaveAttribute("href", `${new URL(second).pathname}/list`);
  });

  test("Sign out on /settings ends the session", async ({ page }) => {
    await signInAs(page, MEMBERSHIP.dana);
    await page.goto("/settings");
    await expect(nav(page).getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL("/");

    await page.goto(CLUB_URL);
    await expect(page).toHaveURL(`/login?${new URLSearchParams({ returnTo: CLUB_URL })}`);
  });
});
