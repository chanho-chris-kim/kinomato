import type { Browser, BrowserContext, Page } from "@playwright/test";
import postgres from "postgres";
import { collectConsoleErrors } from "./console-errors";
import { expect, test } from "./fixtures";
import { finishCodeSignIn, nameYourself } from "./signIn";

// The real deliverable this spec proves: a club that didn't exist when the
// test started goes all the way from the home page through sign-up,
// invites, nomination, voting, lock, confirmation and rating — with zero
// seeded data. Every other spec runs against clubs db/seed.ts creates;
// this one deliberately doesn't (docs/onboarding-spec.md §8.3).
//
// Everyone signs in the real way, once — email, code, name step — and
// later steps reuse that person's actual session (their saved browser
// state), the same way a returning person's browser would.
//
// Serial: every step is a one-way transition the next step builds on.
test.describe.configure({ mode: "serial" });

type State = Awaited<ReturnType<BrowserContext["storageState"]>>;

function checkbox(page: Page, filmTitle: string) {
  return page.getByRole("checkbox", { name: new RegExp(filmTitle) });
}

// A page signed in as someone from an earlier step, checked for console
// errors like the default `page` fixture is.
async function as(browser: Browser, state: State, run: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ storageState: state });
  const page = await context.newPage();
  const errors = collectConsoleErrors(page);
  try {
    await run(page);
    expect(errors, `Console errors:\n\n${errors.join("\n\n")}`).toEqual([]);
  } finally {
    await context.close();
  }
}

test.describe("first night — a brand-new club, start to finish", () => {
  let clubUrl: string;
  let priya: State;
  let owen: State;

  test("Priya starts from the home page, signs up, names herself, and creates the club", async ({
    page,
  }) => {
    const email = "priya.firstnight@example.com";
    await page.goto("/");
    await page.getByRole("link", { name: "Start a club" }).click();
    // /new needs an account: off to sign in, coming back to /new.
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fnew/);
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send code" }).click();
    await finishCodeSignIn(page, email);
    await nameYourself(page, "Priya", "S");

    await expect(page).toHaveURL("/new");
    await page.getByLabel("Club name").fill("Brand New Club");
    // Weekly, Saturday 8pm (the form's own defaults) — a real cadence, not
    // ad_hoc, so lib/schedule.ts has something to compute from.
    await page.getByLabel("Timezone").fill("America/New_York");
    await page.getByRole("button", { name: "Create club" }).click();

    await expect(page).toHaveURL(/\/clubs\/[0-9a-f-]{36}$/);
    clubUrl = page.url();
    await expect(page.getByText("You are: Priya S.")).toBeVisible();
    priya = await page.context().storageState();
  });

  test("Priya invites Owen, and he joins with his own link", async ({ browser }) => {
    let link = "";
    await as(browser, priya, async (page) => {
      await page.goto(clubUrl);
      await page.getByLabel("First name").fill("Owen");
      await page.getByLabel("Last initial").fill("R");
      await page.getByRole("button", { name: "Create invite" }).click();
      link = await page.getByLabel("Invite link for Owen R.").inputValue();
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      const email = "owen.firstnight@example.com";
      await page.goto(link);
      await expect(page.getByRole("heading", { name: "Hi Owen" })).toBeVisible();
      await page.getByLabel("Your email").fill(email);
      await page.getByRole("button", { name: "Continue" }).click();
      await finishCodeSignIn(page, email);
      // Prefilled from Priya's invite; he keeps it.
      await expect(page.getByLabel("First name")).toHaveValue("Owen");
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByText("You are: Owen R.")).toBeVisible();
      owen = await context.storageState();
    } finally {
      await context.close();
    }
  });

  test("Priya (joined first, so she picks first) adds a film to her watchlist", async ({ browser }) => {
    await as(browser, priya, async (page) => {
      await page.goto(`${clubUrl}/list`);
      await page.getByPlaceholder("Search films").fill("Whiplash");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page.locator("li", { hasText: "Whiplash" }).getByRole("button", { name: "Add" }).click();
      await expect(page.getByText("1 films")).toBeVisible();
    });
  });

  test("the club page has its first draft night, waiting on Priya to nominate", async ({ browser }) => {
    await as(browser, priya, async (page) => {
      await page.goto(clubUrl);
      await expect(page.getByRole("heading", { name: "Whose turn" }).locator("+ p")).toHaveText(
        "Priya S.",
      );
      // No seed, no cron, no manual step — the lazy-create path
      // (lib/schedule.ts + the page-load insert) fired on a page load.
      await expect(page.getByRole("heading", { name: "Your turn to nominate" })).toBeVisible();
      await expect(checkbox(page, "Whiplash")).toBeVisible();
    });
  });

  test("Priya nominates Whiplash, opening the vote", async ({ browser }) => {
    await as(browser, priya, async (page) => {
      await page.goto(clubUrl);
      await checkbox(page, "Whiplash").check();
      await page.getByRole("button", { name: "Open voting" }).click();
      await expect(page.getByRole("heading", { name: /nominated by Priya S\./ })).toBeVisible();
    });
  });

  test("Owen votes for it", async ({ browser }) => {
    await as(browser, owen, async (page) => {
      await page.goto(clubUrl);
      await page.locator("li", { hasText: "Whiplash" }).getByRole("button", { name: /Vote/ }).click();
      await expect(page.getByText(/Whiplash.*— 1 vote/)).toBeVisible();
    });
  });

  test("Priya RSVPs yes, then closes voting (she's the owner)", async ({ browser }) => {
    await as(browser, priya, async (page) => {
      await page.goto(clubUrl);
      await page.getByRole("button", { name: "Going", exact: true }).click();
      await expect(page.getByText("Current answer: yes")).toBeVisible();
      await page.getByRole("button", { name: "Close voting and set the pick" }).click();
      await expect(page.getByRole("button", { name: "Close voting and set the pick" })).toHaveCount(0);
    });
  });

  test("the club's night is genuinely scheduled in the future — there's no in-app way to advance past it", async ({
    browser,
  }) => {
    await as(browser, priya, async (page) => {
      await page.goto(clubUrl);
      await expect(page.getByRole("heading", { name: "Did you watch Whiplash?" })).not.toBeVisible();
    });
    // lib/schedule.ts computed a real next-Saturday-8pm occurrence — this
    // is the one deliberate exception to "everything through the app":
    // nothing in this product can fast-forward real time, so the only
    // way to reach confirmation without literally waiting days is a
    // direct nudge of this one column, on the exact row this test's own
    // lock step just produced. Not seeding — there was never a night
    // here to seed until the app itself created it.

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

  test("Owen confirms it watched", async ({ browser }) => {
    await as(browser, owen, async (page) => {
      await page.goto(clubUrl);
      await page.getByRole("button", { name: "Yes", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Did you watch Whiplash?" })).not.toBeVisible();
    });
  });

  test("Priya rates it, closing the loop", async ({ browser }) => {
    await as(browser, priya, async (page) => {
    await page.goto(clubUrl);
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
});
