import type { Page } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import { LEGAL } from "../lib/legal";
import { expect, test } from "./fixtures";
import { signInAsUser } from "./session";
import { expectNoneContain, recordRequestUrls } from "./signIn";

// Pass my turn (docs/onboarding-spec.md §5.10, ruled 2026-11-17): the
// picker, or an owner or admin for them, passes while the night is a
// draft; the next person drafts at once and the passer picks the night
// after. Each test builds its own club.

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
type Role = "owner" | "admin" | "member";

// The owner picked last week, so the members are next, in joining order.
async function clubWith(name: string, people: { key: string; name: string; role: Role }[]) {
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
    const users: Record<string, string> = {};
    const members: Record<string, string> = {};
    let day = 1;
    for (const p of people) {
      users[p.key] = id();
      members[p.key] = id();
      await db.insert(schema.users).values({
        id: users[p.key],
        email: `${p.key}.${clubId.slice(0, 8)}@example.com`,
        displayName: p.name,
        ageBracket: "18_plus",
        ageAttestedAt: at,
      });
      await db.insert(schema.consentEvents).values(
        (["terms", "privacy"] as const).map((document) => ({
          userId: users[p.key],
          document,
          version: LEGAL[document].version,
          acceptedAt: at,
          method: "signup" as const,
        })),
      );
      await db.insert(schema.memberships).values({
        id: members[p.key],
        clubId,
        userId: users[p.key],
        role: p.role,
        joinedAt: new Date(Date.UTC(2026, 0, day++)),
      });
    }
    const owner = people.find((p) => p.role === "owner")!;
    await db.insert(schema.nights).values({
      clubId,
      scheduledAt: new Date(Date.now() - 7 * 86_400_000),
      pickerMembershipId: members[owner.key],
      state: "watched",
      confirmedAt: new Date(Date.now() - 6 * 86_400_000),
      confirmedBy: members[owner.key],
    });
    return { clubId, users, members };
  });
}

const inFlight = async (clubId: string) =>
  (
    await withDb((db) =>
      db
        .select()
        .from(schema.nights)
        .where(and(eq(schema.nights.clubId, clubId), inArray(schema.nights.state, ["draft", "open", "locked"]))),
    )
  )[0];
const membership = async (membershipId: string) =>
  (await withDb((db) => db.select().from(schema.memberships).where(eq(schema.memberships.id, membershipId))))[0];
const finish = (nightId: string, by: string) =>
  withDb((db) =>
    db
      .update(schema.nights)
      .set({ state: "watched", confirmedAt: new Date(), confirmedBy: by })
      .where(eq(schema.nights.id, nightId)),
  );

async function draftFor(page: Page, userId: string, clubId: string) {
  await signInAsUser(page, userId);
  await page.goto(`/clubs/${clubId}`);
  return inFlight(clubId);
}

test.describe("pass my turn", () => {
  test("the picker passes: the next person drafts at once, the passer the night after; the label shows then clears", async ({
    page,
  }) => {
    const c = await clubWith("Pass Club", [
      { key: "owner", name: "Oda P.", role: "owner" },
      { key: "pia", name: "Pia P.", role: "member" },
      { key: "quy", name: "Quy P.", role: "member" },
    ]);
    const urls = recordRequestUrls(page);
    const first = await draftFor(page, c.users.pia, c.clubId);
    expect(first.pickerMembershipId).toBe(c.members.pia);

    await page.getByRole("link", { name: "Pass my turn" }).click();
    await expect(page.locator(".pass-confirm")).toContainText("Pass your turn?");
    await page.locator(".pass-confirm").getByRole("button", { name: "Pass my turn" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Turn passed." })).toBeVisible();

    // The draft went; the next load drafted for Quy at once.
    const next = await inFlight(c.clubId);
    expect(next.pickerMembershipId).toBe(c.members.quy);
    expect(next.id).not.toBe(first.id);
    expect((await membership(c.members.pia)).postponedAt?.toISOString()).toBe(first.scheduledAt.toISOString());

    // Visible as passed, on Members and the rail.
    await page.goto(`/clubs/${c.clubId}/members`);
    await expect(page.locator("main .member-name", { hasText: "Pia P." })).toContainText("Passed this turn");

    // Quy's night ends: Pia is first for the next one, and the label clears.
    await finish(next.id, c.members.quy);
    const after = await draftFor(page, c.users.owner, c.clubId);
    expect(after.pickerMembershipId).toBe(c.members.pia);
    expect((await membership(c.members.pia)).postponedAt).toBeNull();
    await page.goto(`/clubs/${c.clubId}/members`);
    await expect(page.locator("main .member-name", { hasText: "Pia P." })).not.toContainText("Passed this turn");

    expectNoneContain(urls, "Pia", "Quy", "Oda");
  });

  test("an admin passes an absent picker's turn", async ({ page }) => {
    const c = await clubWith("Absent Picker Club", [
      { key: "owner", name: "Ori A.", role: "owner" },
      { key: "ada", name: "Ada A.", role: "admin" },
      { key: "pax", name: "Pax A.", role: "member" },
    ]);
    // Ada picked recently too, so Pax is up.
    await withDb((db) =>
      db.insert(schema.nights).values({
        clubId: c.clubId,
        scheduledAt: new Date(Date.now() - 3 * 86_400_000),
        pickerMembershipId: c.members.ada,
        state: "watched",
        confirmedAt: new Date(Date.now() - 2 * 86_400_000),
        confirmedBy: c.members.ada,
      }),
    );
    const draft = await draftFor(page, c.users.ada, c.clubId);
    expect(draft.pickerMembershipId).toBe(c.members.pax);

    await page.getByRole("link", { name: "Pass Pax A.'s turn" }).click();
    await expect(page.locator(".pass-confirm")).toContainText("Pass Pax A.'s turn?");
    await page.locator(".pass-confirm").getByRole("button", { name: "Pass Pax A.'s turn" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Turn passed." })).toBeVisible();
    const next = await inFlight(c.clubId);
    expect(next.pickerMembershipId).not.toBe(c.members.pax);
    expect((await membership(c.members.pax)).postponedAt).not.toBeNull();
  });

  test("a member can't pass someone else's turn; a forged post is refused", async ({ page, browser }) => {
    const c = await clubWith("Member Pass Club", [
      { key: "owner", name: "Oto M.", role: "owner" },
      { key: "pip", name: "Pip M.", role: "member" },
      { key: "mel", name: "Mel M.", role: "member" },
    ]);
    const draft = await draftFor(page, c.users.mel, c.clubId);
    expect(draft.pickerMembershipId).toBe(c.members.pip);
    await expect(page.getByRole("link", { name: /Pass .*turn/ })).toHaveCount(0);
    await page.goto(`/clubs/${c.clubId}?passFor=1`);
    await expect(page.locator(".pass-confirm")).toHaveCount(0);

    // The owner's confirm loaded, then the owner made a member: refused.
    const context = await browser.newContext();
    try {
      const stale = await context.newPage();
      await signInAsUser(stale, c.users.owner);
      await stale.goto(`/clubs/${c.clubId}?passFor=1`);
      await expect(stale.locator(".pass-confirm")).toBeVisible();
      await withDb((db) =>
        db.update(schema.memberships).set({ role: "member" }).where(eq(schema.memberships.id, c.members.owner)),
      );
      const response = stale.waitForResponse((r) => r.request().method() === "POST");
      await stale.locator(".pass-confirm").getByRole("button", { name: /Pass .*turn/ }).click();
      expect((await response).status()).toBe(500);
    } finally {
      await context.close();
    }
    const still = await inFlight(c.clubId);
    expect([still.id, still.state]).toEqual([draft.id, "draft"]);
    expect((await membership(c.members.pip)).postponedAt).toBeNull();
  });

  test("once voting is open, passing isn't offered, and a stale pass changes nothing", async ({ page }) => {
    const c = await clubWith("Open Pass Club", [
      { key: "owner", name: "Odo O.", role: "owner" },
      { key: "pat", name: "Pat O.", role: "member" },
    ]);
    const draft = await draftFor(page, c.users.pat, c.clubId);
    await page.goto(`/clubs/${c.clubId}?pass=1`);
    await expect(page.locator(".pass-confirm")).toBeVisible();

    // Voting opens before the click lands.
    await withDb(async (db) => {
      const [film] = await db.select().from(schema.films).limit(1);
      await db.insert(schema.nominations).values({ nightId: draft.id, filmId: film.id, membershipId: c.members.pat });
      await db.update(schema.nights).set({ state: "open" }).where(eq(schema.nights.id, draft.id));
    });
    await page.locator(".pass-confirm").getByRole("button", { name: "Pass my turn" }).click();
    await expect(page.locator("main").getByRole("alert")).toHaveText("That turn can't be passed now.");
    const still = await inFlight(c.clubId);
    expect([still.id, still.state]).toEqual([draft.id, "open"]);
    expect((await membership(c.members.pat)).postponedAt).toBeNull();

    // Not offered on an open night, to the picker or the owner.
    await page.goto(`/clubs/${c.clubId}`);
    await expect(page.getByRole("link", { name: "Pass my turn" })).toHaveCount(0);
    await signInAsUser(page, c.users.owner);
    await page.goto(`/clubs/${c.clubId}`);
    await expect(page.getByRole("link", { name: /Pass .*turn/ })).toHaveCount(0);
  });
});

test.describe("films your club wants that fit everyone", () => {
  test("shows only fitting films from others' lists, with counts and no names; adding makes them nominatable; hides once there are enough", async ({
    page,
  }) => {
    const c = await clubWith("Help Club", [
      { key: "owner", name: "Odo H.", role: "owner" },
      { key: "pia", name: "Pia H.", role: "member" },
      { key: "quy", name: "Quy H.", role: "member" },
    ]);
    await withDb(async (db) => {
      const byTitle = async (title: string) => (await db.select().from(schema.films).where(eq(schema.films.title, title)))[0];
      const [arrival, hereditary, bladeRunner, zodiac] = await Promise.all(
        ["Arrival", "Hereditary", "Blade Runner", "Zodiac"].map(byTitle),
      );
      await db.insert(schema.watchlistItems).values([
        { userId: c.users.pia, filmId: arrival.id },
        { userId: c.users.quy, filmId: hereditary.id },
        { userId: c.users.quy, filmId: bladeRunner.id },
        { userId: c.users.quy, filmId: zodiac.id },
        { userId: c.users.owner, filmId: zodiac.id },
      ]);
      // The owner's Gore limit (TMDB's real "gore" id, on Hereditary).
      await db.insert(schema.constraints).values({
        membershipId: c.members.owner,
        kind: "hard",
        ruleType: "keyword",
        value: "10292",
        label: "Gore",
      });
    });
    const urls = recordRequestUrls(page);
    const draft = await draftFor(page, c.users.pia, c.clubId);
    expect(draft.pickerMembershipId).toBe(c.members.pia);

    const help = page.locator(".help-films");
    await expect(help.getByRole("heading")).toHaveText("Films your club wants that fit everyone");
    const items = help.locator("li");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText("Zodiac");
    await expect(items.nth(0)).toContainText("2 others want this");
    await expect(items.nth(1)).toContainText("Blade Runner");
    await expect(items.nth(1)).toContainText("1 other wants this");
    // Not the excluded film, not her own, never a name, never a reason.
    await expect(help).not.toContainText(/Hereditary|Arrival|Odo|Quy|limit|gore/i);

    await help.getByRole("button", { name: "Add Zodiac to my list" }).click();
    await expect(page.locator('input[name="filmId"]')).toHaveCount(2);
    await expect(page.locator("main")).toContainText("Zodiac");
    await expect(help.locator("li")).toHaveCount(1);

    await help.getByRole("button", { name: "Add Blade Runner to my list" }).click();
    await expect(page.locator('input[name="filmId"]')).toHaveCount(3);
    await expect(page.locator(".help-films")).toHaveCount(0);

    expectNoneContain(urls, "Zodiac", "Blade Runner", "Pia", "Quy", "Odo");
  });
});
