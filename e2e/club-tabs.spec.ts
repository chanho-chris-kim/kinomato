import type { Page } from "@playwright/test";
import { CLUB_8_ID, CLUB_ID, DISPLAY_NAME, MEMBERSHIP, MEMBERSHIP_8 } from "../db/seed-fixtures";
import { expect, test } from "./fixtures";
import { memberNames } from "./identity";
import { signInAs } from "./session";
import { finishCodeSignIn, nameYourself } from "./signIn";

// Club tabs (docs/onboarding-spec.md §5.10–5.11.2; rebuild step 5c):
// Tonight · Members under the club header. Desktop Chrome is 1280px wide,
// so Tonight's rail is visible. The "rating heading only for people who
// can rate" case lives in confirm.spec.ts, where club 3's night is
// confirmed and Leo (RSVP'd no) is the member who can't rate.
const CLUB_URL = `/clubs/${CLUB_ID}`;

function clubTabs(page: Page) {
  return page.getByRole("navigation", { name: "Club" });
}

function rail(page: Page) {
  return page.getByRole("complementary", { name: "Club context" });
}

// The theme's accent, resolved to the same rgb() form computed styles use.
async function accent(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--accent)";
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
}

test.describe("club tabs", () => {
  test("Tonight and Members each mark themselves current", async ({ page }) => {
    await signInAs(page, MEMBERSHIP.dana);
    await page.goto(CLUB_URL);
    await expect(clubTabs(page).getByRole("link")).toHaveText(["Tonight", "History", "Members"]);
    await expect(clubTabs(page).getByRole("link", { name: "Tonight" })).toHaveAttribute("aria-current", "page");
    await expect(clubTabs(page).getByRole("link", { name: "Members" })).not.toHaveAttribute("aria-current");
    await expect(clubTabs(page).getByRole("link", { name: "History" })).not.toHaveAttribute("aria-current");

    await clubTabs(page).getByRole("link", { name: "Members" }).click();
    await expect(page).toHaveURL(`${CLUB_URL}/members`);
    await expect(clubTabs(page).getByRole("link", { name: "Members" })).toHaveAttribute("aria-current", "page");
    await expect(clubTabs(page).getByRole("link", { name: "Tonight" })).not.toHaveAttribute("aria-current");
  });

  test("Tonight's main column has no member list and no invite form", async ({ page }) => {
    await signInAs(page, MEMBERSHIP.chris); // the owner: would see the form if it were here
    await page.goto(CLUB_URL);
    await expect(page.getByRole("heading", { name: "Whose turn" })).toBeVisible();
    const main = page.locator("main");
    await expect(main.getByRole("heading", { name: "Members" })).toHaveCount(0);
    await expect(main.getByRole("heading", { name: /Invite/ })).toHaveCount(0);
    await expect(main.getByRole("heading", { name: "Add a person" })).toHaveCount(0);
    await expect(main.getByLabel("First name")).toHaveCount(0);
    await expect(main.getByRole("button", { name: "Create invite" })).toHaveCount(0);
    await expect(memberNames(page)).toHaveCount(0);
    await expect(main.getByText("(you)")).toHaveCount(0);
  });

  test("the viewer's row says (you) with the accent, in the rail on Tonight and on Members", async ({
    page,
  }) => {
    await signInAs(page, MEMBERSHIP.dana);
    await page.goto(CLUB_URL);
    const color = await accent(page);

    const railYou = rail(page).getByText(`${DISPLAY_NAME.dana} (you)`, { exact: true });
    await expect(railYou).toBeVisible();
    await expect(rail(page).getByText("(you)")).toHaveCount(1);
    await expect(railYou.locator(".you")).toHaveCSS("color", color);

    await page.goto(`${CLUB_URL}/members`);
    await expect(memberNames(page)).toHaveCount(6);
    await expect(memberNames(page).filter({ hasText: "(you)" })).toHaveText([`${DISPLAY_NAME.dana} (you)`]);
    const myCard = page.locator("main li.card", { hasText: `${DISPLAY_NAME.dana} (you)` });
    await expect(myCard).toHaveCSS("border-top-color", color);
    await expect(myCard.locator(".you")).toHaveCSS("color", color);
    // Every other card keeps the ordinary border.
    await expect(page.locator("main li.card", { hasText: DISPLAY_NAME.marco })).not.toHaveCSS(
      "border-top-color",
      color,
    );
  });

  test("on a phone, Members (with the Add a person form) fits the screen", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await signInAs(page, MEMBERSHIP_8.hana); // owner of a club with free seats
    await page.goto(`/clubs/${CLUB_8_ID}/members`);
    await expect(page.getByRole("button", { name: "Create invite" })).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });

  test("at 1280px the main column doesn't move or resize between Tonight, Members, History and a tag page", async ({
    page,
  }) => {
    await signInAs(page, MEMBERSHIP.dana);
    await page.goto(CLUB_URL);
    await expect(rail(page)).toBeVisible();
    const tonight = await page.locator("main.main").boundingBox();
    await clubTabs(page).getByRole("link", { name: "Members" }).click();
    await expect(page).toHaveURL(`${CLUB_URL}/members`);
    await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
    const members = await page.locator("main.main").boundingBox();
    expect(tonight).not.toBeNull();
    // Same column: left edge, top and width. Height is just how much each
    // tab has to say.
    const column = (b: typeof tonight) => b && { x: b.x, y: b.y, width: b.width };
    expect(column(members)).toEqual(column(tonight));

    // History, and the tag page under it, keep the same column too.
    await clubTabs(page).getByRole("link", { name: "History" }).click();
    await expect(page).toHaveURL(`${CLUB_URL}/history`);
    await expect(rail(page)).toBeVisible();
    const history = await page.locator("main.main").boundingBox();
    expect(column(history)).toEqual(column(tonight));

    await page.goto(`${CLUB_URL}/tags/cozy`);
    await expect(page.getByRole("heading", { name: /Tagged/ })).toBeVisible();
    await expect(rail(page)).toHaveCount(0);
    const tag = await page.locator("main.main").boundingBox();
    expect(column(tag)).toEqual(column(tonight));
  });

  test("Tonight's rail offers owners and admins Add a person, and no one else", async ({ page }) => {
    await signInAs(page, MEMBERSHIP.chris); // owner
    await page.goto(CLUB_URL);
    await expect(rail(page).getByRole("link", { name: "Add a person →" })).toHaveAttribute(
      "href",
      `${CLUB_URL}/members#add-person`,
    );

    await signInAs(page, MEMBERSHIP.dana); // member
    await page.goto(CLUB_URL);
    await expect(rail(page).getByText(`${DISPLAY_NAME.dana} (you)`)).toBeVisible();
    await expect(rail(page).getByRole("link", { name: /Add a person/ })).toHaveCount(0);
  });

  test("Members has no rail", async ({ page }) => {
    await signInAs(page, MEMBERSHIP.dana);
    await page.goto(`${CLUB_URL}/members`);
    await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
    await expect(rail(page)).toHaveCount(0);
  });

  test("a non-owner sees Members and Invited, but no invite controls and no Add a person", async ({
    page,
  }) => {
    await signInAs(page, MEMBERSHIP.dana);
    await page.goto(`${CLUB_URL}/members`);
    // Movie Night Crew's seeded pending invite (db/seed.ts).
    await expect(page.getByRole("heading", { name: "Invited" })).toBeVisible();
    await expect(page.locator("main .card", { hasText: "Zed Q." })).toContainText("Not started");
    await expect(page.getByRole("button", { name: "Revoke" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Regenerate" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Add a person" })).toHaveCount(0);
    await expect(page.locator("#add-person")).toHaveCount(0);
  });

  test("first run: a new club's owner is pointed at Add a person, and the link lands on it", async ({
    page,
  }) => {
    const email = "tabs-firstrun@example.com";
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send code" }).click();
    await finishCodeSignIn(page, email);
    await nameYourself(page, "Tess", "V");
    // Naming finishes back on / (the login's returnTo) before /new.
    await expect(page).toHaveURL("/");
    await page.goto("/new");
    await page.getByLabel("Club name").fill("Tabs First Run");
    await page.getByLabel("Timezone").fill("America/New_York");
    await page.getByRole("button", { name: "Create club" }).click();
    await expect(page).toHaveURL(/\/clubs\/[0-9a-f-]{36}$/);
    const clubPath = new URL(page.url()).pathname;

    await expect(page.getByRole("heading", { name: "Add the people you watch with." })).toBeVisible();
    // No Invited section on Members when nothing is pending.
    // The main column's prompt (the rail has its own "Add a person →").
    await page.locator("main").getByRole("link", { name: "Add a person", exact: true }).click();
    await expect(page).toHaveURL(`${clubPath}/members#add-person`);
    await expect(page.locator("#add-person").getByRole("heading", { name: "Add a person" })).toBeVisible();
    await expect(page.locator("#add-person")).toBeInViewport();
    await expect(page.getByText("1 of 6 seats.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Invited" })).toHaveCount(0);
    await expect(memberNames(page)).toHaveText(["Tess V. (you)"]);
  });

  test("the tag page marks History current (its home); the watchlist shows no tabs", async ({ page }) => {
    await signInAs(page, MEMBERSHIP.dana);
    await page.goto(`${CLUB_URL}/tags/cozy`);
    await expect(clubTabs(page).getByRole("link")).toHaveText(["Tonight", "History", "Members"]);
    await expect(clubTabs(page).locator('[aria-current="page"]')).toHaveText(["History"]);

    await page.goto(`${CLUB_URL}/list`);
    await expect(page.getByRole("heading", { name: "Movie Night Crew" })).toBeVisible();
    await expect(clubTabs(page)).toHaveCount(0);
  });

  test('"You are:" appears on no club page', async ({ page }) => {
    await signInAs(page, MEMBERSHIP.chris);
    for (const path of ["", "/history", "/members", "/list", "/tags/cozy"]) {
      await page.goto(`${CLUB_URL}${path}`);
      await expect(clubTabs(page).or(page.getByRole("heading", { name: "Movie Night Crew" })).first()).toBeVisible();
      await expect(page.getByText("You are:")).toHaveCount(0);
    }
  });
});
