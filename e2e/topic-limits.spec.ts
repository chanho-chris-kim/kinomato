import type { Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import { LEGAL } from "../lib/legal";
import { expect, test } from "./fixtures";
import { signInAsUser } from "./session";
import { expectNoneContain, recordRequestUrls } from "./signIn";
import { submitAndSettle } from "./submit";

// Topic limits (docs/onboarding-spec.md §5.10, ruled 2026-11-12): a
// curated list of content topics (lib/contentTopics.ts), each a bundle of
// TMDB keyword ids, matched on ids. A hard topic limit also leaves out
// films with no keywords at all. The fixture gives the seeded "Hereditary"
// TMDB's real "gore" keyword. Each test builds its own club.

type Db = ReturnType<typeof drizzle<typeof schema>>;
async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = postgres(process.env.E2E_DATABASE_URL!);
  try {
    return await fn(drizzle(client, { schema }));
  } finally {
    await client.end();
  }
}

const id = () => crypto.randomUUID();
const at = new Date(Date.UTC(2026, 0, 1));

// Owner and picker, with Hereditary (gore), Arrival (keywords, none on
// the list) and a film with no keywords at all on the picker's list, and
// a draft night for the picker.
async function setup(name: string) {
  return withDb(async (db) => {
    const clubId = id();
    await db.insert(schema.clubs).values({
      id: clubId,
      name,
      cadence: "weekly",
      defaultDay: 6,
      defaultTime: "20:00",
      timezone: "America/New_York",
      mode: "in_person",
    });
    const users = { owner: id(), pia: id() };
    const members = { owner: id(), pia: id() };
    let day = 1;
    for (const key of ["owner", "pia"] as const) {
      await db.insert(schema.users).values({
        id: users[key],
        email: `${key}.${clubId.slice(0, 8)}@example.com`,
        displayName: key === "owner" ? "Odo T." : "Pia T.",
        ageBracket: "18_plus",
        ageAttestedAt: at,
      });
      await db.insert(schema.consentEvents).values(
        (["terms", "privacy"] as const).map((document) => ({
          userId: users[key],
          document,
          version: LEGAL[document].version,
          acceptedAt: at,
          method: "signup" as const,
        })),
      );
      await db.insert(schema.memberships).values({
        id: members[key],
        clubId,
        userId: users[key],
        role: key === "owner" ? "owner" : "member",
        joinedAt: new Date(Date.UTC(2026, 0, day++)),
      });
    }
    const [hereditary] = await db.select().from(schema.films).where(eq(schema.films.title, "Hereditary"));
    const [arrival] = await db.select().from(schema.films).where(eq(schema.films.title, "Arrival"));
    const [blank] = await db
      .insert(schema.films)
      .values({
        tmdbId: 900_000_000 + Math.floor(Math.random() * 99_000_000),
        title: `Topicless ${clubId.slice(0, 4)}`,
        year: 2020,
        runtime: 95,
        genres: ["Drama"],
        genreIds: [18],
        keywordIds: [],
        originalLanguage: "en",
      })
      .returning();
    await db.insert(schema.watchlistItems).values(
      [hereditary, arrival, blank].map((f) => ({ userId: users.pia, filmId: f.id })),
    );
    await db.insert(schema.nights).values({
      clubId,
      scheduledAt: new Date(Date.now() + 2 * 86_400_000),
      pickerMembershipId: members.pia,
      state: "draft",
    });
    return { clubId, users, members, titles: { gore: hereditary.title, plain: arrival.title, blank: blank.title } };
  });
}

const form = (page: Page) => page.locator("form.limit-form");
const limitsOf = (membershipId: string) =>
  withDb((db) => db.select().from(schema.constraints).where(eq(schema.constraints.membershipId, membershipId)));

async function addTopic(page: Page, kind: "Hard limit" | "Prefer not", topic: string) {
  await form(page).getByRole("radio", { name: kind, exact: true }).check();
  await form(page).getByRole("radio", { name: "A topic", exact: true }).check();
  await form(page).locator('select[name="topic"]').selectOption({ label: topic });
  // Wait for the outcome to render (one more chip, or an error), not just
  // the POST: a form filled before the re-render lands gets reset under it.
  const chipsBefore = await page.locator("#limits .my-limits .chip").count();
  const done = page.waitForResponse((r) => r.request().method() === "POST");
  await form(page).getByRole("button", { name: "Add" }).click();
  await done;
  await expect
    .poll(async () => {
      const chipsNow = await page.locator("#limits .my-limits .chip").count();
      const alerts = await page.locator("#limits").getByRole("alert").count();
      return chipsNow > chipsBefore || alerts > 0;
    })
    .toBe(true);
}

test.describe("topic limits", () => {
  test("a hard topic limit: the hint, the chip, and the picker loses that topic's film and films with no topics", async ({
    page,
  }) => {
    const s = await setup("Gore Club");
    const urls = recordRequestUrls(page);
    await signInAsUser(page, s.users.owner);
    await page.goto(`/clubs/${s.clubId}/members`);

    // The fail-closed hint shows for Hard limit + A topic only.
    const hint = page.locator(".limit-topic-hint");
    await expect(hint).toBeHidden();
    await form(page).getByRole("radio", { name: "A topic", exact: true }).check();
    await form(page).getByRole("radio", { name: "Hard limit", exact: true }).check();
    await expect(hint).toHaveText("Films with no topic information are also left out, to be safe.");
    await form(page).getByRole("radio", { name: "Prefer not", exact: true }).check();
    await expect(hint).toBeHidden();

    await addTopic(page, "Hard limit", "Gore");
    await expect(page.locator("#limits .my-limits .chip")).toHaveText(["Hard limit: Gore"]);
    const [row] = await limitsOf(s.members.owner);
    expect([row.ruleType, row.label]).toEqual(["keyword", "Gore"]);
    expect(row.value.split(",")).toContain("10292");

    await signInAsUser(page, s.users.pia);
    await page.goto(`/clubs/${s.clubId}`);
    await expect(page.locator("main")).toContainText(s.titles.plain);
    await expect(page.locator("main")).not.toContainText(s.titles.gore);
    // No topic information: left out too, to be safe.
    await expect(page.locator("main")).not.toContainText(s.titles.blank);

    expectNoneContain(urls, "Gore", "topic=", "10292", "keyword=");
  });

  test("a topic preference hides nothing", async ({ page }) => {
    const s = await setup("Prefer Club");
    await signInAsUser(page, s.users.owner);
    await page.goto(`/clubs/${s.clubId}/members`);
    await addTopic(page, "Prefer not", "Gore");
    await expect(page.locator("#limits .my-limits .chip")).toHaveText(["Prefer not: Gore"]);

    await signInAsUser(page, s.users.pia);
    await page.goto(`/clubs/${s.clubId}`);
    for (const title of [s.titles.gore, s.titles.plain, s.titles.blank]) {
      await expect(page.locator("main")).toContainText(title);
    }
  });

  test("a made-up topic, a raw keyword id, or a raw keyword rule is refused", async ({ page }) => {
    const s = await setup("Forged Topic Club");
    await signInAsUser(page, s.users.owner);
    await page.goto(`/clubs/${s.clubId}/members`);
    const alert = page.locator("#limits").getByRole("alert");

    for (const forged of ["tarantulas", "3986", "3888,3986"]) {
      await form(page).getByRole("radio", { name: "A topic", exact: true }).check();
      await form(page)
        .locator('select[name="topic"]')
        .evaluate((el, value) => {
          const option = document.createElement("option");
          option.value = value;
          el.appendChild(option);
          (el as HTMLSelectElement).value = value;
        }, forged);
      // Each refusal reads the same: wait for this one's page, or the next
      // forged form can be reset under the test (e2e/submit.ts).
      await submitAndSettle(page, form(page).getByRole("button", { name: "Add" }), form(page).locator('select[name="topic"]'));
      await expect(alert, forged).toHaveText("Choose a topic from the list.");
    }

    // The rule type itself forged to "keyword", with an id as the topic.
    await form(page)
      .getByRole("radio", { name: "A topic", exact: true })
      .evaluate((el) => {
        (el as HTMLInputElement).value = "keyword";
        (el as HTMLInputElement).checked = true;
      });
    await form(page).getByRole("button", { name: "Add" }).click();
    await expect(alert).toHaveText("Choose a genre, a length or a topic.");
    expect(await limitsOf(s.members.owner)).toEqual([]);
  });
});
