import type { Page } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import { LEGAL } from "../lib/legal";
import { expect, test } from "./fixtures";
import { signInAsUser } from "./session";

// "How this club runs" and pause (docs/onboarding-spec.md §5.10, ruled
// 2026-11-10): every member sees the settings; owner and admin change
// them, with equal powers, re-checked server-side. Changes apply from the
// next time they matter. Pausing never ends the night in flight. Each test
// builds its own club, so no seeded club changes.

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

// A club with an owner and the given others, each joined a day apart.
async function clubWith(db: Db, name: string, people: { key: string; role: "owner" | "admin" | "member" }[]) {
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
    users[p.key] = await person(db, `${p.key}.${clubId.slice(0, 8)}@example.com`, `${p.key[0].toUpperCase()}${p.key.slice(1)} S.`);
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

test.describe("How this club runs", () => {
  test("a plain member sees the settings, but no form; a member's post is refused", async ({ page, browser }) => {
    const c = await withDb((db) =>
      clubWith(db, "Settings Club", [
        { key: "olive", role: "owner" },
        { key: "milo", role: "member" },
      ]),
    );

    await signInAsUser(page, c.users.milo);
    await page.goto(`/clubs/${c.clubId}/members`);
    const section = page.locator("#club-settings");
    await expect(section.getByRole("heading", { name: "How this club runs" })).toBeVisible();
    await expect(section.locator(".club-settings-values")).toContainText("Films each picker nominates3");
    await expect(section.locator(".club-settings-values")).toContainText("The next morning");
    await expect(section.getByRole("button")).toHaveCount(0);
    await expect(section.getByLabel("Films each picker nominates")).toHaveCount(0);

    // A post from someone who isn't owner or admin: the owner's own form,
    // submitted after the owner is demoted, as a stale or forged post
    // would arrive. Its own context, since the refused action errors.
    const setOwnerRole = (role: "owner" | "member") =>
      withDb((db) => db.update(schema.memberships).set({ role }).where(eq(schema.memberships.id, c.members.olive)));
    // Load the owner's form, demote, submit: the server answers 500 and
    // changes nothing. One fresh page per post, since a refused action
    // replaces the page with the error screen.
    const forged = async (submit: (owner: Page) => Promise<void>) => {
      const context = await browser.newContext();
      try {
        const owner = await context.newPage();
        await setOwnerRole("owner");
        await signInAsUser(owner, c.users.olive);
        await owner.goto(`/clubs/${c.clubId}/members`);
        await expect(owner.getByRole("button", { name: "Save", exact: true })).toBeVisible();
        await setOwnerRole("member");
        const response = owner.waitForResponse((r) => r.request().method() === "POST");
        await submit(owner);
        expect((await response).status()).toBe(500);
      } finally {
        await context.close();
      }
    };
    await forged(async (owner) => {
      await owner.getByLabel("Films each picker nominates").fill("1");
      await owner.getByRole("button", { name: "Save", exact: true }).click();
    });
    await forged((owner) => owner.getByRole("button", { name: "Pause the club" }).click());
    const after = await clubRow(c.clubId);
    expect(after.settings).toEqual({});
    expect(after.pausedAt).toBeNull();
  });

  test("an owner changes films per turn, and the picker's cap follows on their turn", async ({ page }) => {
    const c = await withDb(async (db) => {
      const made = await clubWith(db, "Cap Club", [
        { key: "owen", role: "owner" },
        { key: "pia", role: "member" },
      ]);
      const films = await db.select().from(schema.films).limit(4);
      await db.insert(schema.watchlistItems).values(films.map((f) => ({ userId: made.users.pia, filmId: f.id })));
      // Owen has picked before, so Pia is next.
      await db.insert(schema.nights).values({
        clubId: made.clubId,
        scheduledAt: new Date(Date.now() - 7 * 86_400_000),
        pickerMembershipId: made.members.owen,
        state: "watched",
        confirmedAt: new Date(Date.now() - 6 * 86_400_000),
        confirmedBy: made.members.owen,
      });
      return made;
    });

    await signInAsUser(page, c.users.owen);
    await page.goto(`/clubs/${c.clubId}/members`);
    await page.getByLabel("Films each picker nominates").fill("2");
    await page.getByLabel(/When to ask/).selectOption("same_night");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("#club-settings").getByRole("status")).toContainText("Saved.");
    expect((await clubRow(c.clubId)).settings).toEqual({ nomineesPerTurn: 2, confirmAt: "same_night" });

    // Bad input is refused at write time with a fixed message.
    await page.getByLabel("Films each picker nominates").evaluate((el) => {
      (el as HTMLInputElement).removeAttribute("max");
      (el as HTMLInputElement).value = "9";
    });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("#club-settings").getByRole("alert")).toHaveText(
      "Films each picker nominates must be a whole number from 1 to 5.",
    );
    expect((await clubRow(c.clubId)).settings).toEqual({ nomineesPerTurn: 2, confirmAt: "same_night" });

    // Pia's turn: up to 2, and the server holds her to it.
    await signInAsUser(page, c.users.pia);
    await page.goto(`/clubs/${c.clubId}`);
    await expect(page.getByText("Pick up to 2 from your watchlist.")).toBeVisible();
    const boxes = page.locator('input[type="checkbox"][name="filmId"]');
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await expect(boxes.nth(2)).toBeDisabled();
    await page.getByRole("button", { name: /Open voting/ }).click();
    await expect.poll(async () => (await inFlight(c.clubId))[0]?.state).toBe("open");
    const nightId = (await inFlight(c.clubId))[0].id;
    const noms = await withDb((db) => db.select().from(schema.nominations).where(eq(schema.nominations.nightId, nightId)));
    expect(noms).toHaveLength(2);
  });

  test("an admin changes the confirm timing, and it applies to the night that's next confirmable", async ({ page }) => {
    const c = await withDb(async (db) => {
      const made = await clubWith(db, "Timing Club", [
        { key: "ola", role: "owner" },
        { key: "ada", role: "admin" },
      ]);
      const [film] = await db.select().from(schema.films).where(eq(schema.films.title, "Arrival"));
      // Locked, two days out: under the default (the next morning), not
      // confirmable yet.
      await db.insert(schema.nights).values({
        clubId: made.clubId,
        scheduledAt: new Date(Date.now() + 2 * 86_400_000),
        pickerMembershipId: made.members.ola,
        state: "locked",
        winningFilmId: film.id,
        lockedAt: new Date(),
      });
      return made;
    });

    await signInAsUser(page, c.users.ada);
    await page.goto(`/clubs/${c.clubId}`);
    await expect(page.getByText(/Did you watch/)).toHaveCount(0);

    await page.goto(`/clubs/${c.clubId}/members`);
    await page.getByLabel(/When to ask/).selectOption("manual_only");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("#club-settings").getByRole("status")).toContainText("Saved.");

    await page.goto(`/clubs/${c.clubId}`);
    await expect(page.getByText("Did you watch Arrival?")).toBeVisible();
    // The pick itself is untouched.
    const [night] = await inFlight(c.clubId);
    expect(night.state).toBe("locked");
  });

  test("pausing keeps the night in flight, schedules nothing new; resuming does; / says Paused", async ({ page }) => {
    const c = await withDb(async (db) => {
      const made = await clubWith(db, "Pause Club", [
        { key: "oak", role: "owner" },
        { key: "max", role: "member" },
      ]);
      const films = await db.select().from(schema.films).limit(2);
      const [night] = await db
        .insert(schema.nights)
        .values({
          clubId: made.clubId,
          scheduledAt: new Date(Date.now() + 3 * 86_400_000),
          pickerMembershipId: made.members.oak,
          state: "open",
        })
        .returning();
      await db
        .insert(schema.nominations)
        .values(films.map((f) => ({ nightId: night.id, filmId: f.id, membershipId: made.members.oak })));
      return { ...made, nightId: night.id };
    });

    await signInAsUser(page, c.users.oak);
    await page.goto(`/clubs/${c.clubId}/members`);
    await page.getByRole("button", { name: "Pause the club" }).click();
    await expect(page.locator("#club-settings .club-paused")).toHaveText("Paused");
    expect((await clubRow(c.clubId)).pausedAt).not.toBeNull();

    // The open night carries on, unchanged; Tonight says so.
    await page.goto(`/clubs/${c.clubId}`);
    await expect(page.locator(".club-paused-note")).toHaveText(
      "This club is paused. The night in progress, if any, carries on.",
    );
    const flying = await inFlight(c.clubId);
    expect(flying.map((n) => [n.id, n.state])).toEqual([[c.nightId, "open"]]);

    // Every member sees it on the Members tab. On /, the card still shows
    // the night in flight's own time (lib/clubStatus.ts getNextNight): it
    // carries on, so that's the night to show.
    await signInAsUser(page, c.users.max);
    await page.goto(`/clubs/${c.clubId}/members`);
    await expect(page.locator("#club-settings .club-paused")).toHaveText("Paused");
    await page.goto("/");
    const card = page.locator(".clubcard", { hasText: "Pause Club" });
    await expect(card).not.toContainText("Paused");

    // Once that night is over, nothing new is scheduled while paused, and
    // the card says Paused.
    await withDb((db) =>
      db
        .update(schema.nights)
        .set({ state: "cancelled", confirmedAt: new Date(), confirmedBy: c.members.oak })
        .where(eq(schema.nights.id, c.nightId)),
    );
    await page.goto(`/clubs/${c.clubId}`);
    await page.reload();
    expect(await inFlight(c.clubId)).toEqual([]);
    await page.goto("/");
    await expect(card).toContainText("Paused");

    // Resume: the next Tonight load schedules the next night.
    await signInAsUser(page, c.users.oak);
    await page.goto(`/clubs/${c.clubId}/members`);
    await page.getByRole("button", { name: "Resume the club" }).click();
    await expect(page.locator("#club-settings .club-paused")).toHaveCount(0);
    expect(await inFlight(c.clubId)).toEqual([]);
    await page.goto(`/clubs/${c.clubId}`);
    await expect(page.locator(".club-paused-note")).toHaveCount(0);
    const next = await inFlight(c.clubId);
    expect(next.map((n) => n.state)).toEqual(["draft"]);
  });
});
