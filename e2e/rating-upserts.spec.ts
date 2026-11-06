import type { Browser, Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import { MEMBERSHIP_RATING, RATING_CLUB_ID, RATING_NIGHT_ID } from "../db/seed-fixtures";
import { expect, test } from "./fixtures";
import { signInAs } from "./session";

// The ON CONFLICT paths a normal click-through never reaches, on the
// isolated Rating Club (db/seed-fixtures.ts RATING_CLUB_ID): a watched
// night Pia, Quin and Rex all said yes to. Three attendees, so ratings stay
// hidden while Pia and Quin rate (CLAUDE.md blind reveal). Serial: each
// test builds on the last.
test.describe.configure({ mode: "serial" });

const CLUB_URL = `/clubs/${RATING_CLUB_ID}`;

async function withDb<T>(fn: (db: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>): Promise<T> {
  const client = postgres(process.env.E2E_DATABASE_URL!);
  try {
    return await fn(drizzle(client, { schema }));
  } finally {
    await client.end();
  }
}

const ratingsOf = (membershipId: string) =>
  withDb((db) =>
    db
      .select()
      .from(schema.ratings)
      .where(and(eq(schema.ratings.nightId, RATING_NIGHT_ID), eq(schema.ratings.membershipId, membershipId))),
  );

const tagRows = (name: string) =>
  withDb((db) =>
    db
      .select()
      .from(schema.tags)
      .where(and(eq(schema.tags.clubId, RATING_CLUB_ID), eq(schema.tags.name, name))),
  );

const linksTo = (tagId: string) =>
  withDb((db) => db.select().from(schema.ratingTags).where(eq(schema.ratingTags.tagId, tagId)));

async function rate(page: Page, quality: string, fun: string, take: string) {
  await page.getByLabel("Quality (as a number)").fill(quality);
  await page.getByLabel("Fun (as a number)").fill(fun);
  await page.getByLabel("One-line take (optional)").fill(take);
  await page.getByRole("button", { name: "Submit rating" }).click();
}

async function addTag(page: Page, tag: string) {
  await page.getByPlaceholder("Add a tag").fill(tag);
  await page.getByRole("button", { name: "Add tag" }).click();
}

function yourTags(page: Page) {
  return page.locator("h3:has-text('Your tags') + ul li.chip");
}

async function signedInPage(browser: Browser, membershipId: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAs(page, membershipId);
  await page.goto(CLUB_URL);
  return { context, page };
}

test.describe("rating and tag upserts", () => {
  test("re-submitting a rating from a stale tab updates it in place, still hidden until reveal", async ({
    page,
  }) => {
    await signInAs(page, MEMBERSHIP_RATING.pia);
    // Two tabs, both showing the form: the only way the form can be
    // submitted twice, since it disappears once you've rated.
    const stale = await page.context().newPage();
    await page.goto(CLUB_URL);
    await stale.goto(CLUB_URL);
    await expect(stale.getByRole("button", { name: "Submit rating" })).toBeVisible();

    await rate(page, "7", "6", "First take");
    await expect(page.getByText("1/3 ratings in")).toBeVisible();
    const [first] = await ratingsOf(MEMBERSHIP_RATING.pia);
    expect([first.scoreQuality, first.scoreFun, first.hotTake]).toEqual(["7.0", "6.0", "First take"]);

    await rate(stale, "3", "4.5", "Second take");
    await expect(stale.getByText("1/3 ratings in")).toBeVisible();
    const after = await ratingsOf(MEMBERSHIP_RATING.pia);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(first.id);
    expect([after[0].scoreQuality, after[0].scoreFun, after[0].hotTake]).toEqual(["3.0", "4.5", "Second take"]);

    // Blind reveal: still hidden from everyone, Pia included, while Quin
    // and Rex haven't rated.
    await page.reload();
    await expect(page.getByText("1/3 ratings in")).toBeVisible();
    for (const text of ["First take", "Second take", "quality 3.0", "quality 7.0"]) {
      await expect(page.getByText(text)).toHaveCount(0);
    }
    await stale.close();
  });

  test("adding a tag whose normalized name already exists reuses the row and its first-seen casing", async ({
    page,
  }) => {
    await signInAs(page, MEMBERSHIP_RATING.pia);
    await page.goto(CLUB_URL);
    await addTag(page, "Slow Burn");
    await expect(yourTags(page)).toHaveCount(1);
    await expect(yourTags(page).first()).toContainText("Slow Burn");
    const [tag] = await tagRows("slow burn");

    await signInAs(page, MEMBERSHIP_RATING.quin);
    await page.goto(CLUB_URL);
    await rate(page, "5", "5", "");
    await addTag(page, "  slow   BURN ");
    await expect(yourTags(page)).toHaveCount(1);
    await expect(yourTags(page).first()).toContainText("Slow Burn");
    await expect(yourTags(page).first()).not.toContainText("BURN");

    const rows = await tagRows("slow burn");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(tag.id);
    expect(rows[0].displayName).toBe("Slow Burn");
    expect(await linksTo(tag.id)).toHaveLength(2); // Pia's rating and Quin's
  });

  test("adding the same tag to the same rating twice is a no-op", async ({ page }) => {
    await signInAs(page, MEMBERSHIP_RATING.quin);
    await page.goto(CLUB_URL);
    await addTag(page, "slow burn");
    await page.reload();
    await expect(yourTags(page)).toHaveCount(1);

    const [tag] = await tagRows("slow burn");
    const [quin] = await ratingsOf(MEMBERSHIP_RATING.quin);
    const quinLinks = (await linksTo(tag.id)).filter((l) => l.ratingId === quin.id);
    expect(quinLinks).toHaveLength(1);
  });

  // The tags insert's ON CONFLICT fires only when two people add the same
  // new tag at the same moment (otherwise the lookup before it finds the
  // row). Whichever order the race lands in, there's one row, both ratings
  // point at it, and its casing is one of the two typed.
  test("two members adding the same new tag at once still share one row", async ({ browser }) => {
    const pia = await signedInPage(browser, MEMBERSHIP_RATING.pia);
    const quin = await signedInPage(browser, MEMBERSHIP_RATING.quin);
    try {
      await pia.page.getByPlaceholder("Add a tag").fill("Night Owl");
      await quin.page.getByPlaceholder("Add a tag").fill("night OWL");
      await Promise.all([
        pia.page.getByRole("button", { name: "Add tag" }).click(),
        quin.page.getByRole("button", { name: "Add tag" }).click(),
      ]);
      await expect(pia.page.locator("li.chip", { hasText: /night owl/i })).toHaveCount(1);
      await expect(quin.page.locator("li.chip", { hasText: /night owl/i })).toHaveCount(1);

      const rows = await tagRows("night owl");
      expect(rows).toHaveLength(1);
      expect(["Night Owl", "night OWL"]).toContain(rows[0].displayName);
      expect(await linksTo(rows[0].id)).toHaveLength(2);
    } finally {
      await pia.context.close();
      await quin.context.close();
    }
  });
});
