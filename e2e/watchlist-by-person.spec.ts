import type { Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import { CLUB_ID, HOME_CLUB, MEMBER_USER, MEMBERSHIP, MEMBERSHIP_HOME } from "../db/seed-fixtures";
import { expect, test } from "./fixtures";
import { signInAs } from "./session";

// One watchlist per person (docs/onboarding-spec.md §6; rebuild step 6b).
// Kit is in four seeded clubs (HOME_CLUB) with an empty list. Only
// /watchlist is opened here, never a club's Tonight, which would lazily
// create a draft night and change Kit's club cards.
test.describe.configure({ mode: "serial" });

const PRIVACY = "Your clubs can see which films you've added, one film at a time, never your whole list.";
// One list, seen from a given club (rebuild step 6d retired the per-club
// list pages; ?seen= is how a club's view of it is reached now).
const listUrl = (clubId: string) => `/watchlist?seen=${clubId}`;

async function withDb<T>(fn: (db: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>): Promise<T> {
  const client = postgres(process.env.E2E_DATABASE_URL!);
  try {
    return await fn(drizzle(client, { schema }));
  } finally {
    await client.end();
  }
}

async function search(page: Page, query: string) {
  await page.getByPlaceholder("Search films").fill(query);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("heading", { name: `Results for "${query}"` })).toBeVisible();
}

const tile = (page: Page, title: string) => page.locator(".watchlist-item", { hasText: title });

test.describe("one watchlist per person", () => {
  test("the privacy line, under the heading, on an empty list", async ({ page }) => {
    await signInAs(page, MEMBERSHIP_HOME.kit.vote);
    await page.goto(listUrl(HOME_CLUB.vote));
    await expect(page.getByRole("heading", { name: "Your watchlist" })).toBeVisible();
    await expect(page.getByText(PRIVACY, { exact: true })).toBeVisible();
    await expect(page.getByText("Your list is empty.")).toBeVisible();
    // Under the heading, above the search field.
    const order = await page.evaluate((text) => {
      const heading = [...document.querySelectorAll("main h1")].find((h) => h.textContent === "Your watchlist")!;
      const line = [...document.querySelectorAll("main p")].find((p) => p.textContent === text)!;
      const search = document.querySelector('main input[name="q"]')!;
      const follows = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return { lineAfterHeading: follows(heading, line), searchAfterLine: follows(line, search) };
    }, PRIVACY);
    expect(order).toEqual({ lineAfterHeading: true, searchAfterLine: true });
  });

  test("a film added in one club is on the same person's list in another", async ({ page }) => {
    await signInAs(page, MEMBERSHIP_HOME.kit.vote);
    await page.goto(listUrl(HOME_CLUB.vote));
    await search(page, "Arrival");
    await page.locator("li", { hasText: "Arrival" }).getByRole("button", { name: "Add" }).click();
    await expect(tile(page, "Arrival")).toHaveCount(1);

    await page.goto(listUrl(HOME_CLUB.next));
    await expect(tile(page, "Arrival")).toHaveCount(1);
    await expect(page.getByText("1 films")).toBeVisible();
    // Adding it again from this club changes nothing: it's one list.
    await search(page, "Arrival");
    await expect(page.locator("li", { hasText: "Arrival" }).getByRole("button", { name: "Added" })).toBeVisible();
    await page.locator("li", { hasText: "Arrival" }).getByRole("button", { name: "Added" }).click();
    await page.goto(listUrl(HOME_CLUB.next));
    await expect(tile(page, "Arrival")).toHaveCount(1);
    // The privacy line is still there with films on the list.
    await expect(page.getByText(PRIVACY, { exact: true })).toBeVisible();
  });

  test("removing it in one club removes it everywhere", async ({ page }) => {
    await signInAs(page, MEMBERSHIP_HOME.kit.next);
    await page.goto(listUrl(HOME_CLUB.next));
    await tile(page, "Arrival").getByRole("button", { name: "Remove" }).click();
    await expect(tile(page, "Arrival")).toHaveCount(0);

    for (const club of [HOME_CLUB.vote, HOME_CLUB.locked]) {
      await page.goto(listUrl(club));
      await expect(page.getByRole("heading", { name: "Your watchlist" })).toBeVisible();
      await expect(tile(page, "Arrival")).toHaveCount(0);
      await expect(page.getByText("Your list is empty.")).toBeVisible();
    }
  });

  test.describe("overlap counts active members only", () => {
    // Lou once belonged to Movie Night Crew and has left it, with Hereditary
    // on his list. Priya and Marco, both active there, have it too.
    const LEFT_MEMBERSHIP = "aaaaaaaa-6b6b-6b6b-6b6b-000000000001";
    test.beforeAll(async () => {
      await withDb(async (db) => {
        const [hereditary] = await db.select().from(schema.films).where(eq(schema.films.title, "Hereditary"));
        await db.insert(schema.memberships).values({
          id: LEFT_MEMBERSHIP,
          clubId: CLUB_ID,
          userId: MEMBER_USER.lou,
          role: "member",
          joinedAt: new Date("2025-01-01T00:00:00Z"),
          leftAt: new Date("2025-06-01T00:00:00Z"),
        });
        await db
          .insert(schema.watchlistItems)
          .values({ membershipId: LEFT_MEMBERSHIP, userId: MEMBER_USER.lou, filmId: hereditary.id });
      });
    });
    test.afterAll(async () => {
      await withDb(async (db) => {
        await db.delete(schema.watchlistItems).where(eq(schema.watchlistItems.userId, MEMBER_USER.lou));
        await db.delete(schema.memberships).where(eq(schema.memberships.id, LEFT_MEMBERSHIP));
      });
    });

    test("a member who has left doesn't count; where they're active, they do", async ({ page }) => {
      await signInAs(page, MEMBERSHIP.dana);
      await page.goto(listUrl(CLUB_ID));
      await search(page, "Hereditary");
      // Priya and Marco, not Lou: 2, not 3.
      await expect(page.locator("li", { hasText: "Hereditary" })).toContainText("2 others in Movie Night Crew want this");

      // Lou is active in Kit's clubs, so there his film counts.
      await signInAs(page, MEMBERSHIP_HOME.kit.vote);
      await page.goto(listUrl(HOME_CLUB.vote));
      await search(page, "Hereditary");
      await expect(page.locator("li", { hasText: "Hereditary" })).toContainText("1 other in Ninth Club wants this");
    });
  });
});
