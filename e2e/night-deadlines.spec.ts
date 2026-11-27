import type { Page } from "@playwright/test";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import { formatNightTime } from "../lib/clubStatus";
import { LEGAL } from "../lib/legal";
import { unconfirmAtFor } from "../lib/nightDeadlines";
import { expect, test } from "./fixtures";
import { signInAsUser } from "./session";

// Night deadlines (docs/onboarding-spec.md §5.10, ruled 2026-11-21): when
// voting opens, lock_at is stored on the night; at lock, unconfirm_at. A
// settings change never moves a night under way. With no votes, the
// picker's first choice wins (nominations.position). Each test builds its
// own club, in New York.

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
const H = 3600_000;
const TZ = "America/New_York";
const at = new Date(Date.UTC(2026, 0, 1));
const TITLES = ["Arrival", "Hereditary", "Thief"];

// The owner is the picker (so they can also close voting), with three
// seeded films on their list and a draft night `hoursAhead` from now.
async function draftClub(name: string, hoursAhead: number, settings: Record<string, unknown> = {}) {
  return withDb(async (db) => {
    const clubId = id();
    await db.insert(schema.clubs).values({
      id: clubId,
      name,
      cadence: "weekly",
      defaultDay: 6,
      defaultTime: "20:00",
      timezone: TZ,
      mode: "in_person",
      settings,
    });
    const users = { owner: id(), mia: id() };
    const members = { owner: id(), mia: id() };
    for (const [i, key] of (["owner", "mia"] as const).entries()) {
      await db.insert(schema.users).values({
        id: users[key],
        email: `${key}.${clubId.slice(0, 8)}@example.com`,
        displayName: key === "owner" ? "Odo D." : "Mia D.",
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
        joinedAt: new Date(Date.UTC(2026, 0, i + 1)),
      });
    }
    const films = await db.select().from(schema.films);
    const byTitle = Object.fromEntries(TITLES.map((t) => [t, films.find((f) => f.title === t)!]));
    await db.insert(schema.watchlistItems).values(TITLES.map((t) => ({ userId: users.owner, filmId: byTitle[t].id })));
    const scheduledAt = new Date(Math.round((Date.now() + hoursAhead * H) / 60_000) * 60_000);
    const [night] = await db
      .insert(schema.nights)
      .values({ clubId, scheduledAt, pickerMembershipId: members.owner, state: "draft" })
      .returning();
    return { clubId, users, members, nightId: night.id, scheduledAt, byTitle };
  });
}

const nightRow = (nightId: string) =>
  withDb(async (db) => (await db.select().from(schema.nights).where(eq(schema.nights.id, nightId)))[0]);
const nominationsOf = (nightId: string) =>
  withDb((db) =>
    db.select().from(schema.nominations).where(eq(schema.nominations.nightId, nightId)).orderBy(asc(schema.nominations.position)),
  );

// Picks in this order (the order is the picker's ranking), then opens voting.
async function openVotingWith(page: Page, clubId: string, titles: string[]) {
  await page.goto(`/clubs/${clubId}`);
  for (const title of titles) await page.getByRole("checkbox", { name: new RegExp(title) }).check();
  await page.getByRole("button", { name: "Open voting" }).click();
  await expect(page.getByRole("button", { name: "Close voting and set the pick" })).toBeVisible();
}

const near = (actual: Date | null, expected: number, slackMs = 2 * 60_000) => {
  expect(actual).not.toBeNull();
  expect(Math.abs(actual!.getTime() - expected)).toBeLessThan(slackMs);
};

test.describe("night deadlines", () => {
  test("opening voting stores lock_at (24h before by default) and the picker's order, and Tonight shows the close time", async ({
    page,
  }) => {
    const c = await draftClub("Deadline Club", 72);
    await signInAsUser(page, c.users.owner);
    await openVotingWith(page, c.clubId, ["Thief", "Arrival"]);

    const night = await nightRow(c.nightId);
    expect(night.state).toBe("open");
    expect(night.lockAt!.getTime()).toBe(c.scheduledAt.getTime() - 24 * H);
    await expect(page.locator(".voting-closes")).toHaveText(`Voting closes ${formatNightTime(night.lockAt!, TZ)}`);

    const noms = await nominationsOf(c.nightId);
    expect(noms.map((n) => [n.filmId, n.position])).toEqual([
      [c.byTitle.Thief.id, 1],
      [c.byTitle.Arrival.id, 2],
    ]);
  });

  test("a late open gets at least 6 hours, capped at the night", async ({ page }) => {
    const late = await draftClub("Late Open Club", 10);
    await signInAsUser(page, late.users.owner);
    const before = Date.now();
    await openVotingWith(page, late.clubId, ["Arrival"]);
    near((await nightRow(late.nightId)).lockAt, before + 6 * H);

    const later = await draftClub("Very Late Club", 3);
    await signInAsUser(page, later.users.owner);
    await openVotingWith(page, later.clubId, ["Arrival"]);
    expect((await nightRow(later.nightId)).lockAt!.getTime()).toBe(later.scheduledAt.getTime());
  });

  test("a settings change doesn't move an open night's lock_at", async ({ page }) => {
    const c = await draftClub("Steady Club", 72);
    await signInAsUser(page, c.users.owner);
    await openVotingWith(page, c.clubId, ["Arrival"]);
    const lockAt = (await nightRow(c.nightId)).lockAt!;

    // Voting is its own group on How this club runs (u6).
    await page.goto(`/clubs/${c.clubId}/members/settings?edit=voting`);
    await page.getByLabel(/Voting closes/).selectOption("72");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page).toHaveURL(/saved=voting/);
    expect((await withDb((db) => db.select().from(schema.clubs).where(eq(schema.clubs.id, c.clubId))))[0].settings).toMatchObject({
      lockTime: 72,
    });

    expect((await nightRow(c.nightId)).lockAt!.getTime()).toBe(lockAt.getTime());
    await page.goto(`/clubs/${c.clubId}`);
    await expect(page.locator(".voting-closes")).toHaveText(`Voting closes ${formatNightTime(lockAt, TZ)}`);
  });

  test("locking stores unconfirm_at, and the locked night says when it's logged unconfirmed", async ({ page }) => {
    const c = await draftClub("Lock Deadline Club", 72, { autoAdvance: 168 });
    await signInAsUser(page, c.users.owner);
    await openVotingWith(page, c.clubId, ["Arrival", "Thief"]);
    await page.getByRole("button", { name: "Close voting and set the pick" }).click();
    await expect(page.locator(".unconfirm-note")).toBeVisible();

    const night = await nightRow(c.nightId);
    expect(night.state).toBe("locked");
    const expected = unconfirmAtFor({
      confirmAt: "morning_after",
      scheduledAt: night.scheduledAt,
      timezone: TZ,
      lockedAt: night.lockedAt!,
      autoAdvanceHours: 168,
    });
    expect(night.unconfirmAt!.getTime()).toBe(expected.getTime());
    await expect(page.locator(".unconfirm-note")).toHaveText(
      `If nobody answers by ${formatNightTime(expected, TZ)}, this week is logged as unconfirmed and the turn moves on.`,
    );
  });

  test("with no votes, the picker's first choice wins, ahead of the id order", async ({ page }) => {
    const c = await draftClub("First Choice Club", 72);
    await signInAsUser(page, c.users.owner);
    await openVotingWith(page, c.clubId, ["Arrival", "Hereditary", "Thief"]);
    // Rank first the nomination the id fallback would pick last, so only
    // position can make it win.
    const noms = await nominationsOf(c.nightId);
    const byId = [...noms].sort((a, b) => (a.id < b.id ? -1 : 1));
    const favourite = byId[byId.length - 1];
    await withDb(async (db) => {
      for (const [i, n] of [favourite, ...byId.slice(0, -1)].entries()) {
        await db.update(schema.nominations).set({ position: i + 1 }).where(eq(schema.nominations.id, n.id));
      }
    });

    await page.reload();
    await page.getByRole("button", { name: "Close voting and set the pick" }).click();
    await expect(page.locator(".unconfirm-note")).toBeVisible();
    expect((await nightRow(c.nightId)).winningFilmId).toBe(favourite.filmId);
  });

  test("nights from before deadlines were stored still show them (computed for display)", async ({ page }) => {
    const c = await draftClub("Old Night Club", 72, { lockTime: 12 });
    await withDb(async (db) => {
      await db.update(schema.nights).set({ state: "open" }).where(eq(schema.nights.id, c.nightId));
      await db.insert(schema.nominations).values({ nightId: c.nightId, filmId: c.byTitle.Arrival.id, membershipId: c.members.owner });
    });
    await signInAsUser(page, c.users.owner);
    await page.goto(`/clubs/${c.clubId}`);
    await expect(page.locator(".voting-closes")).toHaveText(
      `Voting closes ${formatNightTime(new Date(c.scheduledAt.getTime() - 12 * H), TZ)}`,
    );
    // Locked with no stored deadline either: the note still renders.
    await withDb((db) =>
      db.update(schema.nights).set({ state: "locked", winningFilmId: c.byTitle.Arrival.id, lockedAt: new Date() }).where(eq(schema.nights.id, c.nightId)),
    );
    await page.reload();
    await expect(page.locator(".unconfirm-note")).toContainText("this week is logged as unconfirmed and the turn moves on.");
  });
});

test.describe("deadline settings", () => {
  test("defaults, choices, and a forged value refused", async ({ page }) => {
    const c = await draftClub("Settings Deadline Club", 72);
    await signInAsUser(page, c.users.owner);
    // Two groups since u6: Voting (when voting closes) and After the night
    // (when a night is logged unconfirmed), each edited alone.
    const settingsPage = `/clubs/${c.clubId}/members/settings`;
    await page.goto(`${settingsPage}?edit=voting`);
    const lock = page.getByLabel(/Voting closes/);
    await expect(lock).toHaveValue("24");
    expect(await lock.locator("option").allTextContents()).toEqual(["1 hour", "3 hours", "6 hours", "12 hours", "1 day", "2 days", "3 days"]);
    await expect(page.locator(".deadlines-note")).toContainText("Changing these never moves a night already under way.");
    await lock.selectOption("6");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page).toHaveURL(/saved=voting/);

    await page.goto(`${settingsPage}?edit=after`);
    const unconfirm = page.getByLabel(/log it as unconfirmed/);
    await expect(unconfirm).toHaveValue("48");
    expect(await unconfirm.locator("option").allTextContents()).toEqual(["1 day", "2 days", "1 week"]);
    await unconfirm.selectOption("168");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page).toHaveURL(/saved=after/);
    const settings = async () =>
      (await withDb((db) => db.select().from(schema.clubs).where(eq(schema.clubs.id, c.clubId))))[0].settings;
    expect(await settings()).toMatchObject({ lockTime: 6, autoAdvance: 168 });

    // A value not on the list (a forged post) is refused, and nothing changes.
    await page.goto(`${settingsPage}?edit=voting`);
    await page.getByLabel(/Voting closes/).evaluate((el) => {
      const option = document.createElement("option");
      option.value = "36";
      el.appendChild(option);
      (el as HTMLSelectElement).value = "36";
    });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("#voting").getByRole("alert")).toHaveText("Pick when voting closes.");
    expect(await settings()).toMatchObject({ lockTime: 6, autoAdvance: 168 });
  });
});
