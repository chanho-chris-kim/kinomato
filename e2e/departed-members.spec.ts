import type { Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import { LEGAL } from "../lib/legal";
import { expect, test } from "./fixtures";
import { signInAsUser } from "./session";

// A member who has left stops counting (CLAUDE.md, ruled 2026-11-09):
// toward who must rate before a night's ratings reveal, and toward the
// limits and preferences applied at lock. Their votes still count. Each
// test builds its own club, so no seeded club changes.

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

async function club(db: Db, name: string) {
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
  return clubId;
}

const leave = (membershipId: string) =>
  withDb((db) => db.update(schema.memberships).set({ leftAt: new Date() }).where(eq(schema.memberships.id, membershipId)));

async function rate(page: Page, quality: string, fun: string, take: string) {
  await page.getByLabel("Quality (as a number)").fill(quality);
  await page.getByLabel("Fun (as a number)").fill(fun);
  await page.getByLabel("One-line take (optional)").fill(take);
  await page.getByRole("button", { name: "Submit rating" }).click();
}

test.describe("departed members stop counting", () => {
  test("a yes-RSVP from someone who left no longer holds back the reveal: Tonight, History, the tag page", async ({
    page,
  }) => {
    const s = await withDb(async (db) => {
      const pip = await person(db, "pip.departed@example.com", "Pip A.");
      const quy = await person(db, "quy.departed@example.com", "Quy B.");
      const ren = await person(db, "ren.departed@example.com", "Ren C.");
      const clubId = await club(db, "Reveal Club");
      const m = { pip: id(), quy: id(), ren: id() };
      await db.insert(schema.memberships).values([
        { id: m.pip, clubId, userId: pip, role: "owner", joinedAt: at },
        { id: m.quy, clubId, userId: quy, role: "member", joinedAt: at },
        { id: m.ren, clubId, userId: ren, role: "member", joinedAt: at },
      ]);
      const [film] = await db.select().from(schema.films).where(eq(schema.films.title, "Arrival"));
      const [night] = await db
        .insert(schema.nights)
        .values({
          clubId,
          scheduledAt: daysAgo(3),
          pickerMembershipId: m.pip,
          state: "watched",
          winningFilmId: film.id,
          lockedAt: daysAgo(4),
          confirmedAt: daysAgo(2),
          confirmedBy: m.pip,
        })
        .returning();
      await db.insert(schema.rsvps).values(
        [m.pip, m.quy, m.ren].map((membershipId) => ({ nightId: night.id, membershipId, status: "yes" as const })),
      );
      // Pip has rated, with a tag; Ren never will.
      const [rating] = await db
        .insert(schema.ratings)
        .values({ nightId: night.id, membershipId: m.pip, scoreQuality: "8.0", scoreFun: "7.0", hotTake: "Pip's take" })
        .returning();
      const [tag] = await db
        .insert(schema.tags)
        .values({ clubId, name: "afterglow", displayName: "Afterglow" })
        .returning();
      await db.insert(schema.ratingTags).values({ ratingId: rating.id, tagId: tag.id });
      return { clubId, m, quy };
    });

    await signInAsUser(page, s.quy);
    await page.goto(`/clubs/${s.clubId}`);
    await rate(page, "6", "9", "Quy's take");
    // Three said yes, Ren hasn't rated: hidden everywhere.
    await expect(page.getByText("2/3 ratings in")).toBeVisible();
    await expect(page.getByText("Pip's take")).toHaveCount(0);
    await page.goto(`/clubs/${s.clubId}/history`);
    await expect(page.locator("main li.rating")).toHaveCount(0);
    await page.goto(`/clubs/${s.clubId}/tags/afterglow`);
    await expect(page.locator("main")).not.toContainText("Arrival");

    // Ren leaves without rating: no longer waited on.
    await leave(s.m.ren);

    await page.goto(`/clubs/${s.clubId}`);
    await expect(page.getByText(/ratings in/)).toHaveCount(0);
    await expect(page.locator("main")).toContainText("Pip's take");
    await expect(page.locator("main")).toContainText("Quy's take");

    await page.goto(`/clubs/${s.clubId}/history`);
    const ratings = page.locator("main li.rating");
    await expect(ratings).toHaveCount(2);
    await expect(ratings.filter({ hasText: "Pip A." })).toContainText("Pip's take");
    await expect(ratings.filter({ hasText: "Quy B." })).toContainText("Quy's take");

    await page.goto(`/clubs/${s.clubId}/tags/afterglow`);
    await expect(page.locator("main")).toContainText("Arrival");
  });

  test("at lock, a departed member's preference no longer swings the tie, and their vote still counts", async ({
    page,
  }) => {
    const s = await withDb(async (db) => {
      const ola = await person(db, "ola.departed@example.com", "Ola D.");
      const eve = await person(db, "eve.departed@example.com", "Eve E.");
      const dan = await person(db, "dan.departed@example.com", "Dan F.");
      const clubId = await club(db, "Lock Club");
      const m = { ola: id(), eve: id(), dan: id() };
      await db.insert(schema.memberships).values([
        { id: m.ola, clubId, userId: ola, role: "owner", joinedAt: at },
        { id: m.eve, clubId, userId: eve, role: "member", joinedAt: at },
        { id: m.dan, clubId, userId: dan, role: "member", joinedAt: at },
      ]);
      // Two films where one has a genre the other doesn't.
      const all = await db.select().from(schema.films);
      let pair: { a: (typeof all)[number]; b: (typeof all)[number]; genre: number } | null = null;
      for (const a of all) {
        for (const b of all) {
          const genre = a.genreIds.find((g) => !b.genreIds.includes(g));
          if (a.id !== b.id && genre !== undefined && b.genreIds.length > 0) pair = { a, b, genre };
          if (pair) break;
        }
        if (pair) break;
      }
      if (!pair) throw new Error("No two seeded films with distinct genres.");
      const [night] = await db
        .insert(schema.nights)
        .values({ clubId, scheduledAt: new Date(Date.now() + 2 * 86_400_000), pickerMembershipId: m.ola, state: "open" })
        .returning();
      // Film A's nomination has the lower id, so a clean tie goes to A.
      const [lowId, highId] = [id(), id()].sort();
      await db.insert(schema.nominations).values([
        { id: lowId, nightId: night.id, filmId: pair.a.id, membershipId: m.ola },
        { id: highId, nightId: night.id, filmId: pair.b.id, membershipId: m.ola },
      ]);
      // Dan votes A, Eve votes B: 1–1 only with Dan's vote.
      await db.insert(schema.votes).values([
        { nominationId: lowId, membershipId: m.dan },
        { nominationId: highId, membershipId: m.eve },
      ]);
      await db.insert(schema.rsvps).values([
        { nightId: night.id, membershipId: m.dan, status: "yes" },
        { nightId: night.id, membershipId: m.eve, status: "yes" },
      ]);
      // Dan's soft preference against A's genre: counted, it would hand B
      // the tie.
      await db.insert(schema.constraints).values({
        membershipId: m.dan,
        kind: "soft",
        ruleType: "genre",
        value: String(pair.genre),
        label: "Not this",
      });
      return { clubId, m, ola, nightId: night.id, filmA: pair.a.id };
    });

    await leave(s.m.dan);

    await signInAsUser(page, s.ola);
    await page.goto(`/clubs/${s.clubId}`);
    await page.getByRole("button", { name: "Close voting and set the pick" }).click();
    const nightNow = async () =>
      (await withDb((db) => db.select().from(schema.nights).where(eq(schema.nights.id, s.nightId))))[0];
    await expect.poll(async () => (await nightNow()).state).toBe("locked");
    // A wins: Dan's vote counted (else B wins 1–0) and his preference didn't
    // (else B wins the tie on fewer conflicts).
    expect((await nightNow()).winningFilmId).toBe(s.filmA);
    await expect(page.getByRole("button", { name: "Close voting and set the pick" })).toHaveCount(0);
  });
});
