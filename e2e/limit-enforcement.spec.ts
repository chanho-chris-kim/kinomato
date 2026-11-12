import type { Browser } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import { LEGAL } from "../lib/legal";
import { expect, test } from "./fixtures";
import { signInAsUser } from "./session";

// Hard-limit enforcement (docs/onboarding-spec.md §5.10, ruled
// 2026-11-12). There's no limits UI yet: limits are seeded straight into
// the database. Each test builds its own club.

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
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const soon = () => new Date(Date.now() + 2 * 86_400_000);
type Role = "owner" | "admin" | "member";
type Film = typeof schema.films.$inferSelect;

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
    return { clubId, users, members };
  });
}

// A genre, two seeded films that have it, and two that don't.
async function genreSplit() {
  return withDb(async (db) => {
    const all = (await db.select().from(schema.films)).filter((f) => f.genreIds.length > 0);
    for (const f of all) {
      for (const genre of f.genreIds) {
        const withIt = all.filter((x) => x.genreIds.includes(genre));
        const without = all.filter((x) => !x.genreIds.includes(genre));
        if (withIt.length >= 2 && without.length >= 2) {
          return { genre, hit: withIt.slice(0, 2) as Film[], miss: without.slice(0, 2) as Film[] };
        }
      }
    }
    throw new Error("No genre splits the seeded films.");
  });
}

const hardLimit = (membershipId: string, genre: number, appliesWhenAbsent = false) =>
  withDb((db) =>
    db.insert(schema.constraints).values({
      membershipId,
      kind: "hard",
      ruleType: "genre",
      value: String(genre),
      label: "Seeded",
      appliesWhenAbsent,
    }),
  );

async function openNight(clubId: string, pickerMembershipId: string, filmsInOrder: Film[]) {
  return withDb(async (db) => {
    const [night] = await db
      .insert(schema.nights)
      .values({ clubId, scheduledAt: soon(), pickerMembershipId, state: "open" })
      .returning();
    // Ids in the given order, so a clean tie goes to the first film.
    const nominationIds = filmsInOrder.map(() => id()).sort();
    await db.insert(schema.nominations).values(
      filmsInOrder.map((f, i) => ({ id: nominationIds[i], nightId: night.id, filmId: f.id, membershipId: pickerMembershipId })),
    );
    return { nightId: night.id, nominationIds };
  });
}

const vote = (nominationId: string, membershipId: string) =>
  withDb((db) => db.insert(schema.votes).values({ nominationId, membershipId }));
const nightRow = async (nightId: string) =>
  (await withDb((db) => db.select().from(schema.nights).where(eq(schema.nights.id, nightId))))[0];
const nominationRows = (ids: string[]) =>
  withDb((db) => db.select().from(schema.nominations).where(inArray(schema.nominations.id, ids)));

async function lockAs(page: import("@playwright/test").Page, userId: string, clubId: string, nightId: string) {
  await signInAsUser(page, userId);
  await page.goto(`/clubs/${clubId}`);
  await page.getByRole("button", { name: "Close voting and set the pick" }).click();
  await expect.poll(async () => (await nightRow(nightId)).state).not.toBe("open");
}

async function refusedPost(browser: Browser, userId: string, url: string, forge: (p: import("@playwright/test").Page) => Promise<void>) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await signInAsUser(page, userId);
    await page.goto(url);
    const response = page.waitForResponse((r) => r.request().method() === "POST");
    await forge(page);
    expect((await response).status()).toBe(500);
  } finally {
    await context.close();
  }
}

test.describe("hard-limit enforcement", () => {
  test("an excluded film isn't offered, a forged post can't nominate it, and an emptied list says so without a name", async ({
    page,
    browser,
  }) => {
    const split = await genreSplit();
    const c = await clubWith("Pool Club", [
      { key: "owner", name: "Odo P.", role: "owner" },
      { key: "pia", name: "Pia P.", role: "member" },
      { key: "max", name: "Max P.", role: "member" },
    ]);
    const nightId = await withDb(async (db) => {
      await db.insert(schema.watchlistItems).values([
        { userId: c.users.pia, filmId: split.hit[0].id },
        { userId: c.users.pia, filmId: split.miss[0].id },
      ]);
      const [night] = await db
        .insert(schema.nights)
        .values({ clubId: c.clubId, scheduledAt: soon(), pickerMembershipId: c.members.pia, state: "draft" })
        .returning();
      return night.id;
    });
    // Max's limit excludes one of Pia's films.
    await hardLimit(c.members.max, split.genre);

    await signInAsUser(page, c.users.pia);
    await page.goto(`/clubs/${c.clubId}`);
    const boxes = page.locator('input[type="checkbox"][name="filmId"]');
    await expect(boxes).toHaveCount(1);
    await expect(page.locator("main")).toContainText(split.miss[0].title);
    await expect(page.locator("main")).not.toContainText(split.hit[0].title);
    // Nothing counts or explains what's missing.
    await expect(page.locator("main")).not.toContainText(/limit|hidden|excluded|Max/i);

    // A forged post naming the excluded film is refused; nothing changes.
    await refusedPost(browser, c.users.pia, `/clubs/${c.clubId}`, async (p) => {
      // Tick the one film offered (the selector's own state enables the
      // button), then swap its value for the excluded film before posting.
      const box = p.locator('input[name="filmId"]').first();
      await box.check();
      await box.evaluate((el, filmId) => ((el as HTMLInputElement).value = filmId), split.hit[0].id);
      await p.getByRole("button", { name: /Open voting/ }).click();
    });
    expect((await nightRow(nightId)).state).toBe("draft");
    expect(await withDb((db) => db.select().from(schema.nominations).where(eq(schema.nominations.nightId, nightId)))).toEqual([]);

    // Everything on her list is out now: the empty-pool line, no names.
    await hardLimit(c.members.owner, split.miss[0].genreIds[0]);
    await page.reload();
    await expect(page.locator(".empty-pool")).toHaveText(
      "None of your watchlist fits this club right now. Add a few more films.",
    );
    await expect(page.locator("main")).not.toContainText(/limit|Max|Odo|empty\./i);
  });

  test("a limit added during voting drops that nominee at lock; the pick and History come from the rest", async ({ page }) => {
    const split = await genreSplit();
    const c = await clubWith("Lock Drop Club", [
      { key: "owner", name: "Ola L.", role: "owner" },
      { key: "vic", name: "Vic L.", role: "member" },
      { key: "wen", name: "Wen L.", role: "member" },
    ]);
    const night = await openNight(c.clubId, c.members.owner, [split.hit[0], split.miss[0]]);
    const [hitNom, missNom] = night.nominationIds;
    // The excluded film would win 2–1.
    await vote(hitNom, c.members.vic);
    await vote(hitNom, c.members.wen);
    await vote(missNom, c.members.owner);
    await hardLimit(c.members.vic, split.genre);

    await lockAs(page, c.users.owner, c.clubId, night.nightId);
    const locked = await nightRow(night.nightId);
    expect([locked.state, locked.winningFilmId]).toEqual(["locked", split.miss[0].id]);
    const noms = await nominationRows([hitNom, missNom]);
    expect(noms.find((n) => n.id === hitNom)!.droppedAt).not.toBeNull();
    expect(noms.find((n) => n.id === missNom)!.droppedAt).toBeNull();
    // Votes are kept, never deleted.
    const votesLeft = await withDb((db) =>
      db.select().from(schema.votes).where(inArray(schema.votes.nominationId, [hitNom, missNom])),
    );
    expect(votesLeft).toHaveLength(3);

    // Once watched, History's tally has only the film that stood.
    await withDb((db) =>
      db
        .update(schema.nights)
        .set({ state: "watched", confirmedAt: new Date(), confirmedBy: c.members.owner })
        .where(eq(schema.nights.id, night.nightId)),
    );
    await page.goto(`/clubs/${c.clubId}/history`);
    const entry = page.locator("main li.history-night");
    await expect(entry).toContainText(split.miss[0].title);
    await expect(entry).not.toContainText(split.hit[0].title);
  });

  test("a limit that excludes every nominee cancels the night; the same picker drafts again; votes stay", async ({
    page,
  }) => {
    const split = await genreSplit();
    const c = await clubWith("Cancel Club", [
      { key: "owner", name: "Oma C.", role: "owner" },
      { key: "val", name: "Val C.", role: "member" },
    ]);
    // Oma picked last week, so Val is up, and stays up after a cancel.
    await withDb((db) =>
      db.insert(schema.nights).values({
        clubId: c.clubId,
        scheduledAt: daysAgo(7),
        pickerMembershipId: c.members.owner,
        state: "watched",
        confirmedAt: daysAgo(6),
        confirmedBy: c.members.owner,
      }),
    );
    const night = await openNight(c.clubId, c.members.val, split.hit);
    await vote(night.nominationIds[0], c.members.owner);
    await hardLimit(c.members.owner, split.genre);

    await lockAs(page, c.users.owner, c.clubId, night.nightId);
    const cancelled = await nightRow(night.nightId);
    expect([cancelled.state, cancelled.winningFilmId]).toEqual(["cancelled", null]);
    expect((await nominationRows(night.nominationIds)).every((n) => n.droppedAt !== null)).toBe(true);
    expect(
      await withDb((db) => db.select().from(schema.votes).where(inArray(schema.votes.nominationId, night.nominationIds))),
    ).toHaveLength(1);

    await page.goto(`/clubs/${c.clubId}`);
    const [draft] = await withDb((db) =>
      db
        .select()
        .from(schema.nights)
        .where(and(eq(schema.nights.clubId, c.clubId), eq(schema.nights.state, "draft"))),
    );
    expect(draft.pickerMembershipId).toBe(c.members.val);
  });

  test("an RSVP no before lock lifts that person's hard limit, unless it applies when they're absent", async ({ page }) => {
    const split = await genreSplit();
    for (const appliesWhenAbsent of [false, true]) {
      const c = await clubWith(`Rsvp Club ${appliesWhenAbsent}`, [
        { key: "owner", name: "Oli R.", role: "owner" },
        { key: "vee", name: "Vee R.", role: "member" },
        { key: "dee", name: "Dee R.", role: "member" },
      ]);
      const night = await openNight(c.clubId, c.members.owner, [split.hit[0], split.miss[0]]);
      const [hitNom, missNom] = night.nominationIds;
      await vote(hitNom, c.members.vee);
      await vote(hitNom, c.members.dee);
      await vote(missNom, c.members.owner);
      await hardLimit(c.members.dee, split.genre, appliesWhenAbsent);
      await withDb((db) =>
        db.insert(schema.rsvps).values({ nightId: night.nightId, membershipId: c.members.dee, status: "no" }),
      );
      await lockAs(page, c.users.owner, c.clubId, night.nightId);
      expect((await nightRow(night.nightId)).winningFilmId, `appliesWhenAbsent=${appliesWhenAbsent}`).toBe(
        appliesWhenAbsent ? split.miss[0].id : split.hit[0].id,
      );
    }
  });

  test("a departed member's limit never applies, at nomination or at lock", async ({ page }) => {
    const split = await genreSplit();
    const c = await clubWith("Departed Limit Club", [
      { key: "owner", name: "Oya D.", role: "owner" },
      { key: "pat", name: "Pat D.", role: "member" },
      { key: "lex", name: "Lex D.", role: "member" },
    ]);
    await hardLimit(c.members.lex, split.genre, true);
    await withDb((db) =>
      db.update(schema.memberships).set({ leftAt: new Date() }).where(eq(schema.memberships.id, c.members.lex)),
    );

    // Nomination: Pat's film with that genre is offered.
    await withDb(async (db) => {
      await db.insert(schema.watchlistItems).values({ userId: c.users.pat, filmId: split.hit[0].id });
      await db
        .insert(schema.nights)
        .values({ clubId: c.clubId, scheduledAt: soon(), pickerMembershipId: c.members.pat, state: "draft" });
    });
    await signInAsUser(page, c.users.pat);
    await page.goto(`/clubs/${c.clubId}`);
    await expect(page.locator("main")).toContainText(split.hit[0].title);
    await page.locator('input[name="filmId"]').first().check();
    await page.getByRole("button", { name: /Open voting/ }).click();
    const openNow = () =>
      withDb((db) =>
        db.select().from(schema.nights).where(and(eq(schema.nights.clubId, c.clubId), eq(schema.nights.state, "open"))),
      );
    await expect.poll(async () => (await openNow()).length).toBe(1);
    const [open] = await openNow();

    // Lock: still not dropped.
    await lockAs(page, c.users.owner, c.clubId, open.id);
    const locked = await nightRow(open.id);
    expect([locked.state, locked.winningFilmId]).toEqual(["locked", split.hit[0].id]);
  });
});
