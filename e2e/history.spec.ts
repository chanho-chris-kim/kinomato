import type { Page } from "@playwright/test";
import {
  CLUB_7_ID,
  DISPLAY_NAME_HISTORY,
  HISTORY_CLUB_ID,
  HISTORY_TAKE,
  MEMBERSHIP,
  MEMBERSHIP_7,
  MEMBERSHIP_HISTORY,
} from "../db/seed-fixtures";
import { expect, test } from "./fixtures";
import { signInAs } from "./session";

// The History tab (docs/onboarding-spec.md §5.10; rebuild step 5f), on the
// seeded History Club (db/seed-fixtures.ts HISTORY_CLUB_ID): four finished
// nights. CLAUDE.md "History is shared and symmetric": tallies and veto
// counts, never voters or vetoers.
const HISTORY_URL = `/clubs/${HISTORY_CLUB_ID}/history`;
const NAMES = Object.values(DISPLAY_NAME_HISTORY);

function entries(page: Page) {
  return page.locator("main li.history-night");
}

function entry(page: Page, heading: string) {
  return entries(page).filter({ has: page.getByRole("heading", { name: heading }) });
}

test.describe("History", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, MEMBERSHIP_HISTORY.rae);
  });

  test("History is the current tab, every finished night newest first, cancelled and unconfirmed labelled", async ({
    page,
  }) => {
    await page.goto(HISTORY_URL);
    const tabs = page.getByRole("navigation", { name: "Club" });
    await expect(tabs.getByRole("link")).toHaveText(["Tonight", "History", "Members"]);
    await expect(tabs.getByRole("link", { name: "History" })).toHaveAttribute("aria-current", "page");
    // The rail, as on Tonight, with the viewer marked.
    await expect(
      page.getByRole("complementary", { name: "Club context" }).getByText(`${DISPLAY_NAME_HISTORY.rae} (you)`),
    ).toBeVisible();

    await expect(entries(page).locator("h2")).toHaveText([
      /^Get Out/,
      "We didn't meet",
      /^Blade Runner/,
      "Zodiac",
    ]);
    await expect(entry(page, "We didn't meet").locator(".pill")).toHaveText("Cancelled");
    await expect(entry(page, "We didn't meet")).toContainText(`${DISPLAY_NAME_HISTORY.sol}'s pick`);
    await expect(entry(page, "Zodiac").locator(".pill")).toHaveText("Unconfirmed");
    await expect(entry(page, "Zodiac")).toContainText("Nobody confirmed whether the club watched it.");
    // Watched nights carry no state label.
    await expect(entry(page, "Blade Runner").locator(".pill")).toHaveCount(0);
  });

  test("a watched night: final tally with the winner marked, veto count, who came, revealed ratings", async ({
    page,
  }) => {
    await page.goto(HISTORY_URL);
    const night = entry(page, "Blade Runner");
    await expect(night).toContainText(`${DISPLAY_NAME_HISTORY.rae}'s pick`);
    await expect(night.locator(".tally li")).toHaveText([
      /^Blade Runner \(1982\) · picked\s*2 votes$/,
      /^Arrival \(2016\)\s*1 vote$/,
      /^Hereditary \(2018\)\s*0 votes$/,
    ]);
    await expect(night.getByText("1 veto", { exact: true })).toBeVisible();
    await expect(night).toContainText(`Came: ${DISPLAY_NAME_HISTORY.rae}, ${DISPLAY_NAME_HISTORY.sol}`);

    await expect(night.locator(".rating")).toHaveCount(2);
    const rae = night.locator(".rating", { hasText: DISPLAY_NAME_HISTORY.rae });
    await expect(rae).toContainText("quality 8.5, fun 9.0");
    await expect(rae).toContainText(`"${HISTORY_TAKE.revealed}"`);
    await expect(rae.getByRole("link", { name: "Rainy" })).toHaveAttribute(
      "href",
      `/clubs/${HISTORY_CLUB_ID}/tags/rainy`,
    );
    await expect(night.locator(".rating", { hasText: DISPLAY_NAME_HISTORY.sol })).toContainText(
      "quality 7.0, fun 8.0",
    );
  });

  test("no voter or vetoer is named anywhere in a tally, after lock", async ({ page }) => {
    await page.goto(HISTORY_URL);
    await expect(entries(page)).toHaveCount(4);
    // Every member voted on something here, and Tib vetoed Hereditary.
    for (const tally of await page.locator("main .tally").all()) {
      for (const name of NAMES) await expect(tally).not.toContainText(name);
    }
    const vetoLine = entry(page, "Blade Runner").getByText(/veto/);
    await expect(vetoLine).toHaveText("1 veto");
    // Tib appears only where it's no secret: as a picker, and as someone who came.
    const tibMentions = await entries(page).filter({ hasText: DISPLAY_NAME_HISTORY.tib }).locator("h2").allTextContents();
    expect(tibMentions).toEqual([expect.stringMatching(/^Get Out/), "Zodiac"]);
  });

  test("a watched night still being rated hides every score and take", async ({ page }) => {
    await page.goto(HISTORY_URL);
    const night = entry(page, "Get Out");
    await expect(night.getByText("Ratings are hidden until everyone who came has rated.")).toBeVisible();
    await expect(night).not.toContainText(HISTORY_TAKE.hidden);
    await expect(night).not.toContainText("quality");
    await expect(night.locator(".rating")).toHaveCount(0);
    // Who came is still history.
    await expect(night).toContainText(
      `Came: ${DISPLAY_NAME_HISTORY.rae}, ${DISPLAY_NAME_HISTORY.sol}, ${DISPLAY_NAME_HISTORY.tib}`,
    );
  });

  test("non-members get a 404", async ({ page }) => {
    await signInAs(page, MEMBERSHIP.dana);
    // page.request carries the session cookie without the browser logging
    // the 404 as a console error (same as gating.spec.ts).
    const response = await page.request.get(HISTORY_URL, { maxRedirects: 0 });
    expect(response.status()).toBe(404);
    expect(await response.text()).not.toContain("History Club");
    // A member gets the page, so this isn't a blanket 404.
    await signInAs(page, MEMBERSHIP_HISTORY.sol);
    expect((await page.request.get(HISTORY_URL, { maxRedirects: 0 })).status()).toBe(200);
  });

  test("a club with no finished nights shows the empty state", async ({ page }) => {
    await signInAs(page, MEMBERSHIP_7.wes);
    await page.goto(`/clubs/${CLUB_7_ID}/history`);
    await expect(
      page.getByText("No nights yet. Your club's first movie night will show up here once it's done."),
    ).toBeVisible();
    await expect(entries(page)).toHaveCount(0);
  });
});
