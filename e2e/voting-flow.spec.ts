import type { Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import { CLUB_ID, DISPLAY_NAME, FILM_TITLE } from "../db/seed-fixtures";
import { collectConsoleErrors } from "./console-errors";
import { expect, test } from "./fixtures";
import {
  getNextPicker,
  type RotationMembership,
  type RotationNight,
} from "../lib/rotation";

const CLUB_URL = `/clubs/${CLUB_ID}`;

async function pickIdentity(page: Page, name: string) {
  await page.goto(CLUB_URL);
  await page.getByRole("button", { name, exact: true }).click();
}

function nomineeRow(page: Page, filmTitle: string) {
  return page.locator("li", { hasText: filmTitle });
}

async function voteCount(page: Page, filmTitle: string): Promise<number> {
  const text = await nomineeRow(page, filmTitle).textContent();
  const match = text?.match(/(\d+)\s+votes?/);
  if (!match) {
    throw new Error(`No vote count found for "${filmTitle}" in: ${text}`);
  }
  return Number(match[1]);
}

// Serial, not just workers: 1 — so a failure in "vote" skips "change
// vote" instead of running it against unexpected state and producing a
// second, confusing failure.
test.describe.configure({ mode: "serial" });

test.describe("voting flow", () => {
  test("picking a name persists identity across reload", async ({ page }) => {
    await pickIdentity(page, DISPLAY_NAME.marco);
    await expect(page.getByText(`You are: ${DISPLAY_NAME.marco}`)).toBeVisible();

    await page.reload();
    await expect(page.getByText(`You are: ${DISPLAY_NAME.marco}`)).toBeVisible();
  });

  test("voting for a nominee increments its count", async ({ page }) => {
    // Paddington 2 has zero seeded votes (db/seed.ts) — a clean baseline.
    await pickIdentity(page, DISPLAY_NAME.sam);
    const before = await voteCount(page, FILM_TITLE.paddington2);
    expect(before).toBe(0);

    await nomineeRow(page, FILM_TITLE.paddington2)
      .getByRole("button", { name: /Vote/ })
      .click();

    await expect(async () => {
      expect(await voteCount(page, FILM_TITLE.paddington2)).toBe(before + 1);
    }).toPass();
  });

  test("changing a vote moves it, does not duplicate (db.batch path)", async ({
    page,
  }) => {
    // Continues as Sam: currently voted for Paddington 2 from the
    // previous test, about to move that vote to The Thing. Re-picking
    // the identity just re-sets the same cookie in this fresh context —
    // the vote itself lives in the database, not the browser.
    await pickIdentity(page, DISPLAY_NAME.sam);

    const paddingtonBefore = await voteCount(page, FILM_TITLE.paddington2);
    const theThingBefore = await voteCount(page, FILM_TITLE.theThing);
    expect(paddingtonBefore).toBe(1); // Sam's vote, from the previous test

    await nomineeRow(page, FILM_TITLE.theThing)
      .getByRole("button", { name: /Vote/ })
      .click();

    await expect(async () => {
      // If db.batch() ever duplicated instead of moving the vote,
      // Paddington 2 would stay at 1 instead of dropping to 0.
      expect(await voteCount(page, FILM_TITLE.paddington2)).toBe(
        paddingtonBefore - 1,
      );
      expect(await voteCount(page, FILM_TITLE.theThing)).toBe(theThingBefore + 1);
    }).toPass();
  });

  test("two members voting from separate browser contexts both count correctly", async ({
    browser,
  }) => {
    const chrisContext = await browser.newContext();
    const joContext = await browser.newContext();
    try {
      const chrisPage = await chrisContext.newPage();
      const joPage = await joContext.newPage();
      // The fixtures.ts auto-fixture only sees the default `page` — these
      // are manually created, so they need their own collectors.
      const chrisErrors = collectConsoleErrors(chrisPage);
      const joErrors = collectConsoleErrors(joPage);

      await pickIdentity(chrisPage, DISPLAY_NAME.chris);
      await pickIdentity(joPage, DISPLAY_NAME.jo);

      const chungkingBefore = await voteCount(chrisPage, FILM_TITLE.chungkingExpress);
      const theThingBefore = await voteCount(joPage, FILM_TITLE.theThing);

      await nomineeRow(chrisPage, FILM_TITLE.chungkingExpress)
        .getByRole("button", { name: /Vote/ })
        .click();
      await nomineeRow(joPage, FILM_TITLE.theThing)
        .getByRole("button", { name: /Vote/ })
        .click();

      await chrisPage.reload();
      await joPage.reload();

      expect(await voteCount(chrisPage, FILM_TITLE.chungkingExpress)).toBe(
        chungkingBefore + 1,
      );
      expect(await voteCount(joPage, FILM_TITLE.theThing)).toBe(theThingBefore + 1);

      expect(chrisErrors, `Chris's console:\n\n${chrisErrors.join("\n\n")}`).toEqual([]);
      expect(joErrors, `Jo's console:\n\n${joErrors.join("\n\n")}`).toEqual([]);
    } finally {
      await chrisContext.close();
      await joContext.close();
    }
  });

  test("toggling RSVP to no persists across reload", async ({ page }) => {
    await pickIdentity(page, DISPLAY_NAME.dana);
    await page.getByRole("button", { name: "Not going" }).click();
    await expect(page.getByText("Current answer: no")).toBeVisible();

    await page.reload();
    await expect(page.getByText("Current answer: no")).toBeVisible();
  });

  test("the displayed picker matches lib/rotation.ts for the seeded data", async ({
    page,
  }) => {
    const databaseUrl = process.env.E2E_DATABASE_URL!;
    const client = postgres(databaseUrl);
    const db = drizzle(client, { schema });

    const clubMemberships = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.clubId, CLUB_ID));
    const clubNights = await db
      .select()
      .from(schema.nights)
      .where(eq(schema.nights.clubId, CLUB_ID));
    await client.end();

    const rotationMemberships: RotationMembership[] = clubMemberships.map((m) => ({
      id: m.id,
      identityKey: m.identityKey,
      clubId: m.clubId,
      joinedAt: m.joinedAt,
      leftAt: m.leftAt,
      postponedAt: m.postponedAt,
    }));
    const rotationNights: RotationNight[] = clubNights.map((n) => ({
      pickerMembershipId: n.pickerMembershipId,
      state: n.state,
      scheduledAt: n.scheduledAt,
    }));
    const expected = getNextPicker({
      memberships: rotationMemberships,
      nights: rotationNights,
      clubPausedAt: null,
    });
    if (!expected) {
      throw new Error("Expected a picker for the seeded data, got none.");
    }
    const expectedName = clubMemberships.find((m) => m.id === expected.id)
      ?.displayName;
    if (!expectedName) {
      throw new Error("Computed picker's membership id wasn't in the club's list.");
    }

    // Whoever we're viewing as doesn't affect whose turn it is — Priya
    // just hasn't been used as a login in an earlier test.
    await pickIdentity(page, DISPLAY_NAME.priya);
    const whoseTurn = page.locator("h2:has-text('Whose turn') + p");
    await expect(whoseTurn).toHaveText(expectedName);
  });
});
