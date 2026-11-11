import type { Page } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import { LEGAL } from "../lib/legal";
import { addDays, getNextOccurrence, localDateParts, zonedTimeToUtc } from "../lib/schedule";
import { expect, test } from "./fixtures";
import { signInAsUser } from "./session";

// Club details (docs/onboarding-spec.md §5.10, ruled 2026-11-10): owner or
// admin edit name, how often, day, time, timezone and mode. Edits apply
// from the next night; a night in flight keeps its date. A biweekly or
// monthly schedule that would otherwise count from created_at needs a
// "First night on" date. No "no fixed schedule" until nights can be
// scheduled by hand. Each test builds its own club.

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
const TZ = "America/New_York";

async function person(db: Db, email: string, name: string) {
  const userId = id();
  await db.insert(schema.users).values({ id: userId, email, displayName: name, ageBracket: "18_plus", ageAttestedAt: at });
  await db.insert(schema.consentEvents).values(
    (["terms", "privacy"] as const).map((document) => ({
      userId,
      document,
      version: LEGAL[document].version,
      acceptedAt: at,
      method: "signup" as const,
    })),
  );
  return userId;
}

async function clubWith(
  db: Db,
  name: string,
  people: { key: string; role: "owner" | "admin" | "member" }[],
  cadence: "weekly" | "ad_hoc" = "weekly",
) {
  const clubId = id();
  await db.insert(schema.clubs).values({
    id: clubId,
    name,
    cadence,
    defaultDay: 6,
    defaultTime: "20:00",
    timezone: TZ,
    mode: "in_person",
  });
  const users: Record<string, string> = {};
  const members: Record<string, string> = {};
  let day = 1;
  for (const p of people) {
    users[p.key] = await person(db, `${p.key}.${clubId.slice(0, 8)}@example.com`, `${p.key[0].toUpperCase()}${p.key.slice(1)} D.`);
    members[p.key] = id();
    await db.insert(schema.memberships).values({
      id: members[p.key],
      clubId,
      userId: users[p.key],
      role: p.role,
      joinedAt: new Date(Date.UTC(2026, 0, day++)),
    });
  }
  return { clubId, users, members };
}

const clubRow = (clubId: string) =>
  withDb(async (db) => (await db.select().from(schema.clubs).where(eq(schema.clubs.id, clubId)))[0]);
const inFlight = (clubId: string) =>
  withDb((db) =>
    db
      .select()
      .from(schema.nights)
      .where(and(eq(schema.nights.clubId, clubId), inArray(schema.nights.state, ["draft", "open", "locked"]))),
  );

// The Saturday `weeksAhead` weeks after the next one, and the Friday and
// the last Saturday around it, as YYYY-MM-DD in the club's timezone.
function saturdays(weeksAhead: number) {
  const today = localDateParts(new Date(), TZ);
  const weekday = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
  const nextSat = addDays(today, (6 - weekday + 7) % 7 || 7);
  const iso = (d: { year: number; month: number; day: number }) =>
    `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
  const chosen = addDays(nextSat, weeksAhead * 7);
  return { chosen, chosenIso: iso(chosen), fridayIso: iso(addDays(chosen, -1)), pastIso: iso(addDays(nextSat, -7)) };
}

const detailsForm = (page: Page) => page.locator("form.club-details-form");
const detailsAlert = (page: Page) => page.locator("#club-settings .details-error");
const saveDetails = (page: Page) => page.getByRole("button", { name: "Save details" });

test.describe("club details", () => {
  test("an admin renames the club and moves the time: the header and the / card follow", async ({ page }) => {
    const c = await withDb((db) =>
      clubWith(db, "Old Name Club", [
        { key: "otto", role: "owner" },
        { key: "ava", role: "admin" },
      ]),
    );
    await signInAsUser(page, c.users.ava);
    await page.goto(`/clubs/${c.clubId}/members`);
    const form = detailsForm(page);
    await form.getByLabel("Club name", { exact: true }).fill("New Name Club");
    await form.getByLabel("Time", { exact: true }).fill("19:30");
    await saveDetails(page).click();
    await expect(page.locator("#club-settings").getByRole("status")).toContainText("applies from the next night");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("New Name Club");
    await expect(page.locator("main").getByText("Weekly, Saturdays at 7:30pm · In person")).toBeVisible();
    const row = await clubRow(c.clubId);
    expect([row.name, row.defaultTime]).toEqual(["New Name Club", "19:30:00"]);

    await page.goto("/");
    const card = page.locator(".clubcard", { hasText: "New Name Club" });
    await expect(card).toContainText("Sat 7:30pm");
    await expect(page.locator(".clubcard", { hasText: "Old Name Club" })).toHaveCount(0);
  });

  test("a night in flight keeps its date; the next draft uses the new schedule", async ({ page }) => {
    const c = await withDb((db) =>
      clubWith(db, "Flight Club", [
        { key: "orla", role: "owner" },
        { key: "mo", role: "member" },
      ]),
    );
    await signInAsUser(page, c.users.orla);
    // Tonight drafts the first night at the old time.
    await page.goto(`/clubs/${c.clubId}`);
    const [draft] = await inFlight(c.clubId);
    expect(draft.state).toBe("draft");

    await page.goto(`/clubs/${c.clubId}/members`);
    await detailsForm(page).locator('select[name="defaultDay"]').selectOption("5");
    await detailsForm(page).getByLabel("Time", { exact: true }).fill("18:15");
    await saveDetails(page).click();
    await expect(page.locator("#club-settings").getByRole("status")).toBeVisible();

    // Untouched.
    const [still] = await inFlight(c.clubId);
    expect([still.id, still.scheduledAt.toISOString()]).toEqual([draft.id, draft.scheduledAt.toISOString()]);

    // Once it's over, the next draft is on the new day at the new time.
    await withDb((db) =>
      db
        .update(schema.nights)
        .set({ state: "cancelled", confirmedAt: new Date(), confirmedBy: c.members.orla })
        .where(eq(schema.nights.id, draft.id)),
    );
    await page.goto(`/clubs/${c.clubId}`);
    const [next] = await inFlight(c.clubId);
    expect(next.id).not.toBe(draft.id);
    const row = await clubRow(c.clubId);
    const expected = getNextOccurrence(
      { cadence: "weekly", defaultDay: 5, defaultTime: "18:15", timezone: TZ },
      new Date(),
      row.createdAt,
    );
    expect(next.scheduledAt.toISOString()).toBe(expected!.toISOString());
  });

  test("weekly to every other week needs a first night: on the day, not past; the next draft lands on it", async ({
    page,
  }) => {
    const c = await withDb((db) => clubWith(db, "Fortnight Club", [{ key: "omar", role: "owner" }]));
    const sat = saturdays(3);
    await signInAsUser(page, c.users.omar);
    await page.goto(`/clubs/${c.clubId}/members`);
    const form = detailsForm(page);
    await expect(form.getByLabel("First night on", { exact: true })).toBeHidden();
    await form.locator('select[name="cadence"]').selectOption("biweekly");
    await expect(form.getByLabel("First night on", { exact: true })).toBeVisible();

    // None given: refused, and what was typed comes back without being in
    // the URL.
    await form.getByLabel("Club name", { exact: true }).fill("Fortnight Club Two");
    await saveDetails(page).click();
    await expect(detailsAlert(page)).toHaveText("Pick the date of the first night.");
    expect(page.url()).not.toContain("Fortnight");
    await expect(form.getByLabel("Club name", { exact: true })).toHaveValue("Fortnight Club Two");
    await expect(form.locator('select[name="cadence"]')).toHaveValue("biweekly");

    await form.getByLabel("First night on", { exact: true }).fill(sat.fridayIso);
    await saveDetails(page).click();
    await expect(detailsAlert(page)).toHaveText("The first night has to be on a Saturday.");

    await form.getByLabel("First night on", { exact: true }).fill(sat.pastIso);
    await saveDetails(page).click();
    await expect(detailsAlert(page)).toHaveText("The first night can't be in the past.");
    let row = await clubRow(c.clubId);
    expect([row.cadence, row.name]).toEqual(["weekly", "Fortnight Club"]);

    await form.getByLabel("First night on", { exact: true }).fill(sat.chosenIso);
    await saveDetails(page).click();
    await expect(page.locator("#club-settings").getByRole("status")).toBeVisible();
    row = await clubRow(c.clubId);
    expect([row.cadence, row.name, row.settings]).toEqual([
      "biweekly",
      "Fortnight Club Two",
      { scheduleAnchor: sat.chosenIso },
    ]);

    await page.goto(`/clubs/${c.clubId}`);
    const [draft] = await inFlight(c.clubId);
    expect(draft.scheduledAt.toISOString()).toBe(
      zonedTimeToUtc(sat.chosen, { hour: 20, minute: 0 }, TZ).toISOString(),
    );
  });

  test("no fixed schedule isn't offered; an ad hoc club can move to a fixed one", async ({ page }) => {
    const c = await withDb((db) => clubWith(db, "Loose Club", [{ key: "opal", role: "owner" }], "ad_hoc"));
    await signInAsUser(page, c.users.opal);
    await page.goto(`/clubs/${c.clubId}/members`);
    const cadence = detailsForm(page).locator('select[name="cadence"]');
    await expect(cadence.locator("option")).toHaveText(["Weekly", "Every other week", "Monthly"]);

    // Forced in anyway: refused.
    await cadence.evaluate((el) => {
      const option = document.createElement("option");
      option.value = "ad_hoc";
      el.appendChild(option);
      (el as HTMLSelectElement).value = "ad_hoc";
    });
    await saveDetails(page).click();
    await expect(detailsAlert(page)).toHaveText(
      "No fixed schedule can't be chosen until nights can be scheduled by hand.",
    );

    await detailsForm(page).locator('select[name="cadence"]').selectOption("weekly");
    await saveDetails(page).click();
    await expect(page.locator("#club-settings").getByRole("status")).toBeVisible();
    expect((await clubRow(c.clubId)).cadence).toBe("weekly");
    // And it schedules again.
    await page.goto(`/clubs/${c.clubId}`);
    expect((await inFlight(c.clubId)).map((n) => n.state)).toEqual(["draft"]);
  });

  test("a member sees the details but no form; a post from someone not owner or admin is refused", async ({
    page,
    browser,
  }) => {
    const c = await withDb((db) =>
      clubWith(db, "Locked Door Club", [
        { key: "oona", role: "owner" },
        { key: "mel", role: "member" },
      ]),
    );
    await signInAsUser(page, c.users.mel);
    await page.goto(`/clubs/${c.clubId}/members`);
    await expect(page.locator(".club-settings-values")).toContainText("Weekly, Saturdays at 8pm · In person");
    await expect(page.locator(".club-settings-values")).toContainText(TZ);
    await expect(detailsForm(page)).toHaveCount(0);

    const context = await browser.newContext();
    try {
      const owner = await context.newPage();
      await signInAsUser(owner, c.users.oona);
      await owner.goto(`/clubs/${c.clubId}/members`);
      await detailsForm(owner).getByLabel("Club name", { exact: true }).fill("Taken Over");
      await withDb((db) =>
        db.update(schema.memberships).set({ role: "member" }).where(eq(schema.memberships.id, c.members.oona)),
      );
      const response = owner.waitForResponse((r) => r.request().method() === "POST");
      await saveDetails(owner).click();
      expect((await response).status()).toBe(500);
    } finally {
      await context.close();
    }
    expect((await clubRow(c.clubId)).name).toBe("Locked Door Club");
  });
});
