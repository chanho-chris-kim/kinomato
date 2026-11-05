import type { Page } from "@playwright/test";
import { count, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import { HOME_CLUB, HOME_CLUB_NAME, MEMBERSHIP_HOME } from "../db/seed-fixtures";
import { expect, test } from "./fixtures";
import { signInAs } from "./session";
import { finishCodeSignIn, nameYourself } from "./signIn";

// The signed-in / (docs/onboarding-spec.md §5.7, Ruling A; rebuild step
// 5b). Kit is in four seeded clubs, one per card state (db/seed-fixtures.ts
// HOME_CLUB). Every status line, the priority order and the sort are unit
// tested in lib/clubStatus.test.ts; this checks they reach the page.

function cards(page: Page) {
  return page.locator("main a.clubcard");
}

function card(page: Page, key: keyof typeof HOME_CLUB) {
  return cards(page).filter({ hasText: HOME_CLUB_NAME[key] });
}

// Read straight from the E2E database: `/` must never write a night.
async function nightCount() {
  const client = postgres(process.env.E2E_DATABASE_URL!);
  try {
    const db = drizzle(client, { schema });
    const [all] = await db.select({ n: count() }).from(schema.nights);
    const [kits] = await db
      .select({ n: count() })
      .from(schema.nights)
      .where(inArray(schema.nights.clubId, Object.values(HOME_CLUB)));
    return { all: all.n, kits: kits.n };
  } finally {
    await client.end();
  }
}

test.describe("club cards on /", () => {
  test("greets Kit by first name, with one card per club, each linking to it", async ({ page }) => {
    await signInAs(page, MEMBERSHIP_HOME.kit.vote);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hi, Kit");
    await expect(cards(page)).toHaveCount(4);
    for (const key of Object.keys(HOME_CLUB) as (keyof typeof HOME_CLUB)[]) {
      await expect(card(page, key)).toHaveAttribute("href", `/clubs/${HOME_CLUB[key]}`);
    }
    // The old stopgap is gone.
    await expect(page.getByText("kinomato", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Start a club" })).toHaveAttribute("href", "/new");
  });

  test("action cards come first, each with its dot and 'Needs you' in words", async ({ page }) => {
    await signInAs(page, MEMBERSHIP_HOME.kit.vote);
    await page.goto("/");
    // Actions (soonest first), then the rest (soonest first).
    await expect(cards(page).locator(".h-display")).toHaveText([
      HOME_CLUB_NAME.vote,
      HOME_CLUB_NAME.nominate,
      HOME_CLUB_NAME.locked,
      HOME_CLUB_NAME.next,
    ]);

    await expect(card(page, "vote").locator(".status")).toHaveText("Needs you: Voting — you haven't voted");
    await expect(card(page, "nominate").locator(".status")).toHaveText("Needs you: Your turn to nominate");
    for (const key of ["vote", "nominate"] as const) {
      await expect(card(page, key).locator(".dot")).toHaveCount(1);
      await expect(card(page, key).locator(".status")).toHaveCSS("font-weight", "600");
      // Visually hidden: present for a screen reader, not on screen.
      await expect(card(page, key).locator(".sr-only")).toHaveText("Needs you:");
      await expect(card(page, key).locator(".sr-only")).toHaveCSS("position", "absolute");
    }
  });

  test("non-action cards: no dot, no 'Needs you', and the right lines", async ({ page }) => {
    await signInAs(page, MEMBERSHIP_HOME.kit.vote);
    await page.goto("/");
    await expect(card(page, "locked").locator(".status")).toHaveText("Blade Runner, locked in");
    await expect(card(page, "next").locator(".status")).toHaveText("Lou B. picks next");
    for (const key of ["locked", "next"] as const) {
      await expect(card(page, key).locator(".dot")).toHaveCount(0);
      await expect(card(page, key)).not.toContainText("Needs you");
    }
    // A club with no night yet shows its standing night, computed for
    // display only: Saturday-style "Sat 8:00pm" in the club's timezone.
    await expect(card(page, "next").locator(".tiny")).toHaveText(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) 8:00pm$/);
    await expect(card(page, "locked").locator(".tiny")).toHaveText(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2}:\d{2}(am|pm)$/);
  });

  test("never on a card: member counts, seats, votes, RSVP", async ({ page }) => {
    await signInAs(page, MEMBERSHIP_HOME.kit.vote);
    await page.goto("/");
    for (const word of [/member/i, /seat/i, /\bvotes?\b/i, /going/i, /rsvp/i, / of 6/]) {
      await expect(cards(page).filter({ hasText: word })).toHaveCount(0);
    }
  });

  test("opening / never creates a night", async ({ page }) => {
    const before = await nightCount();
    await signInAs(page, MEMBERSHIP_HOME.kit.vote);
    await page.goto("/");
    await expect(cards(page)).toHaveCount(4);
    await page.reload();
    await expect(cards(page)).toHaveCount(4);
    expect(await nightCount()).toEqual(before);
    // Twelfth Club still has no nights at all: its card's date and
    // "picks next" are computed, not stored.
    expect(before.kits).toBe(3);
  });

  test("a fresh account sees the empty state", async ({ page }) => {
    const email = "home-empty@example.com";
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send code" }).click();
    await finishCodeSignIn(page, email);
    await nameYourself(page, "Eve", "N");
    await expect(page).toHaveURL("/");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hi, Eve");
    await expect(page.getByText("You're not in a club yet.")).toBeVisible();
    const start = page.locator("main").getByRole("link", { name: "Start a club" });
    await expect(start).toHaveCount(1);
    await expect(start).toHaveClass(/primary/);
    await expect(
      page.getByText(
        "Waiting to join a friend's club? Ask them for your own invite link, since each link is made for one person.",
      ),
    ).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
  });
});
