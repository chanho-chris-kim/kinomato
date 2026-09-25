import type { Page } from "@playwright/test";
import postgres from "postgres";
import { expect, test } from "./fixtures";

// The real deliverable this spec proves: a club that didn't exist when
// the test started can go all the way from /new through nomination,
// voting, lock, confirmation, and rating — with zero seeded data. Every
// other spec runs against clubs db/seed.ts pre-populates (which sets
// display_name directly and never goes through validateMemberName —
// those single-word names like "Chris" are untouched by the name-field
// ruling below); this one deliberately doesn't seed, since the whole
// point of first-night is that a club no longer needs hand-seeding to
// reach its first nomination.
//
// Every name is first name + last initial (CLAUDE.md's name-field
// ruling) — Priya S. and Owen R. here, never bare "Priya"/"Owen".
//
// Serial: every step is a one-way transition the next step builds on.
test.describe.configure({ mode: "serial" });

function checkbox(page: Page, filmTitle: string) {
  return page.getByRole("checkbox", { name: new RegExp(filmTitle) });
}

test.describe("first night — a brand-new club, start to finish", () => {
  let clubUrl: string;
  let joinUrl: string;

  test("Priya creates the club with Owen pre-added", async ({ page }) => {
    await page.goto("/new");
    await page.getByLabel("Club name").fill("Brand New Club");
    await page.getByLabel("First name").first().fill("Priya");
    await page.getByLabel("Last initial").first().fill("S");
    // Weekly, Saturday 8pm (the form's own defaults) — a real cadence,
    // not ad_hoc, so lib/schedule.ts has something to compute from.
    await page.getByLabel("Timezone").fill("America/New_York");
    await page.locator('input[name="memberFirstName0"]').fill("Owen");
    await page.locator('input[name="memberLastInitial0"]').fill("R");
    await page.getByRole("button", { name: "Create club" }).click();

    await expect(page).toHaveURL(/\/clubs\/[0-9a-f-]{36}$/);
    clubUrl = page.url();
    // Read the real invite link off the page rather than constructing
    // it — it carries a token now (CLAUDE.md), which this test has no
    // way to predict.
    const inviteHref = await page.locator('a[href*="/join?token="]').getAttribute("href");
    joinUrl = new URL(inviteHref!, clubUrl).toString();
    await expect(page.getByText("You are: Priya S.")).toBeVisible();
  });

  test("Owen joins by claiming his pre-added name", async ({ page }) => {
    await page.goto(joinUrl);
    await page.getByRole("button", { name: "Owen R.", exact: true }).click();
    await expect(page).toHaveURL(clubUrl);
    await expect(page.getByText("You are: Owen R.")).toBeVisible();
  });

  test("Priya (joined first, so she picks first) adds a film to her watchlist", async ({
    page,
  }) => {
    // /list has its own identity picker (same as the main club page) —
    // this is Priya's very first visit to any page in this club, before
    // a night of any kind exists.
    await page.goto(`${clubUrl}/list`);
    await page.getByRole("button", { name: "Priya S.", exact: true }).click();
    await page.getByPlaceholder("Search films").fill("Whiplash");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page
      .locator("li", { hasText: "Whiplash" })
      .getByRole("button", { name: "Add" })
      .click();
  });

  test("visiting the club page lazily creates the first draft night", async ({ page }) => {
    await page.goto(clubUrl);
    await page.getByRole("button", { name: "Priya S.", exact: true }).click();
    await expect(page.getByText("Whose turn")).toBeVisible();
    await expect(page.locator("main")).toContainText("Priya S.");
    // No seed, no cron, no manual step — this is the lazy-create path
    // (lib/schedule.ts + the page-load insert) firing for the first
    // time, on this exact request.
    await expect(page.getByRole("heading", { name: "Your turn to nominate" })).toBeVisible();
    await expect(checkbox(page, "Whiplash")).toBeVisible();
  });

  test("Priya nominates Whiplash, opening the vote", async ({ page }) => {
    await page.goto(clubUrl);
    await page.getByRole("button", { name: "Priya S.", exact: true }).click();
    await checkbox(page, "Whiplash").check();
    await page.getByRole("button", { name: "Open voting" }).click();
    await expect(page.getByRole("heading", { name: /nominated by Priya S\./ })).toBeVisible();
  });

  test("Owen votes for it", async ({ page }) => {
    await page.goto(clubUrl);
    await page.getByRole("button", { name: "Owen R.", exact: true }).click();
    await page
      .locator("li", { hasText: "Whiplash" })
      .getByRole("button", { name: /Vote/ })
      .click();
    await expect(page.getByText(/Whiplash.*— 1 vote/)).toBeVisible();
  });

  test("Priya RSVPs yes, then closes voting (she's the owner)", async ({ page }) => {
    await page.goto(clubUrl);
    await page.getByRole("button", { name: "Priya S.", exact: true }).click();
    await page.getByRole("button", { name: "Going", exact: true }).click();
    await expect(page.getByText("Current answer: yes")).toBeVisible();

    await page.getByRole("button", { name: "Close voting and set the pick" }).click();
  });

  test("the club's night is genuinely scheduled in the future — there's no in-app way to advance past it", async ({
    page,
  }) => {
    await page.goto(clubUrl);
    await page.getByRole("button", { name: "Priya S.", exact: true }).click();
    // lib/schedule.ts computed a real next-Saturday-8pm occurrence — this
    // is the one deliberate exception to "everything through the app":
    // nothing in this product can fast-forward real time, so the only
    // way to reach confirmation without literally waiting days is a
    // direct nudge of this one column, on the exact row this test's own
    // lock step just produced. Not seeding — there was never a night
    // here to seed until the app itself created it.
    await expect(
      page.getByRole("heading", { name: "Did you watch Whiplash?" }),
    ).not.toBeVisible();

    const sql = postgres(process.env.E2E_DATABASE_URL!);
    try {
      const clubId = clubUrl.split("/").pop();
      // 2 days, not 1 — confirmAt defaults to "morning_after" (9am
      // local the day after scheduledAt), so "1 day ago" isn't
      // reliably past that threshold at every time of day this test
      // might run. "2 days ago" is, regardless.
      await sql`UPDATE nights SET scheduled_at = now() - interval '2 days' WHERE club_id = ${clubId!}`;
    } finally {
      await sql.end();
    }
  });

  test("Owen confirms it watched", async ({ page }) => {
    await page.goto(clubUrl);
    await page.getByRole("button", { name: "Owen R.", exact: true }).click();
    await page.getByRole("button", { name: "Yes", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Did you watch Whiplash?" }),
    ).not.toBeVisible();
  });

  test("Priya rates it, closing the loop", async ({ page }) => {
    await page.goto(clubUrl);
    await page.getByRole("button", { name: "Priya S.", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Rate Whiplash" })).toBeVisible();

    // RatingSlider's paired number input — .fill() fires a real input
    // event, which is what actually updates the underlying React state
    // (and so the hidden input the form submits); a raw DOM value
    // assignment on the range input wouldn't.
    await page.getByLabel("Quality (as a number)").fill("9");
    await page.getByLabel("Fun (as a number)").fill("8");
    await page.getByLabel("One-line take (optional)").fill("Not quite my tempo.");
    await page.getByRole("button", { name: "Submit rating" }).click();

    // Priya is the only attendee (only she RSVP'd yes), so the blind
    // reveal completes the instant her own rating lands.
    await expect(page.getByText("Not quite my tempo.")).toBeVisible();
  });
});
