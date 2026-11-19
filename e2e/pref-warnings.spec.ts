import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import { LEGAL } from "../lib/legal";
import { expect, test } from "./fixtures";
import { signInAsUser } from "./session";
import { expectNoneContain, recordRequestUrls } from "./signIn";

// "Someone coming would rather not." (docs/onboarding-spec.md §5.10, ruled
// 2026-11-18): on an open night's nominee, when someone coming has a genre
// or runtime preference against it, and at least three others besides the
// viewer are coming. Never a name. Each test builds its own club.

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
const NOTE = "Someone coming would rather not.";
type Film = typeof schema.films.$inferSelect;

// A genre one seeded film has and another doesn't.
async function genreSplit() {
  return withDb(async (db) => {
    const all = (await db.select().from(schema.films)).filter((f) => f.genreIds.length > 0);
    for (const hit of all) {
      for (const genre of hit.genreIds) {
        const miss = all.find((f) => !f.genreIds.includes(genre));
        if (miss) return { genre, hit: hit as Film, miss: miss as Film };
      }
    }
    throw new Error("No genre splits the seeded films.");
  });
}

// The owner (viewer, who can lock), and Ana, Ben, Cal, Dot; an open night
// the owner picked, with the given films nominated, and yes-RSVPs from
// the given people.
async function openNight(name: string, filmsToNominate: Film[], coming: string[]) {
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
    const keys = ["owner", "ana", "ben", "cal", "dot"];
    const users: Record<string, string> = {};
    const members: Record<string, string> = {};
    for (const [i, key] of keys.entries()) {
      users[key] = id();
      members[key] = id();
      await db.insert(schema.users).values({
        id: users[key],
        email: `${key}.${clubId.slice(0, 8)}@example.com`,
        displayName: `${key[0].toUpperCase()}${key.slice(1)} W.`,
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
    const [night] = await db
      .insert(schema.nights)
      .values({ clubId, scheduledAt: new Date(Date.now() + 2 * 86_400_000), pickerMembershipId: members.owner, state: "open" })
      .returning();
    await db
      .insert(schema.nominations)
      .values(filmsToNominate.map((f) => ({ nightId: night.id, filmId: f.id, membershipId: members.owner })));
    if (coming.length) {
      await db
        .insert(schema.rsvps)
        .values(coming.map((key) => ({ nightId: night.id, membershipId: members[key], status: "yes" as const })));
    }
    return { clubId, users, members, nightId: night.id };
  });
}

const prefer = (membershipId: string, ruleType: "genre" | "keyword", value: string, label: string) =>
  withDb((db) =>
    db.insert(schema.constraints).values({ membershipId, kind: "soft", ruleType, value, label }),
  );

test.describe("soft-preference warnings", () => {
  test("three others coming and a matching genre preference: the note on that nominee only, no name; gone once locked, never in History", async ({
    page,
  }) => {
    const split = await genreSplit();
    const n = await openNight("Warn Club", [split.hit, split.miss], ["ana", "ben", "cal"]);
    await prefer(n.members.ana, "genre", String(split.genre), "Preflabel");
    const urls = recordRequestUrls(page);

    await signInAsUser(page, n.users.owner);
    await page.goto(`/clubs/${n.clubId}`);
    const hit = page.locator("li.nominee", { hasText: split.hit.title });
    const miss = page.locator("li.nominee", { hasText: split.miss.title });
    await expect(hit.locator(".pref-note")).toHaveText(NOTE);
    await expect(miss.locator(".pref-note")).toHaveCount(0);
    await expect(page.locator(".pref-note")).toHaveCount(1);
    // The fixed sentence and nothing else: no name, no count, no preference.
    for (const who of ["Ana W.", "Ben W.", "Cal W.", "Dot W."]) {
      await expect(page.locator("li.nominee").filter({ hasText: who })).toHaveCount(0);
    }
    await expect(page.locator("body")).not.toContainText("Preflabel");

    // Locked: no note anywhere.
    await page.getByRole("button", { name: "Close voting and set the pick" }).click();
    await expect
      .poll(async () => (await withDb((db) => db.select().from(schema.nights).where(eq(schema.nights.id, n.nightId))))[0].state)
      .toBe("locked");
    await page.reload();
    await expect(page.locator(".pref-note")).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(NOTE);

    // Finished: History says nothing either.
    await withDb((db) =>
      db
        .update(schema.nights)
        .set({ state: "watched", confirmedAt: new Date(), confirmedBy: n.members.owner })
        .where(eq(schema.nights.id, n.nightId)),
    );
    await page.goto(`/clubs/${n.clubId}/history`);
    await expect(page.locator("main")).not.toContainText(NOTE);

    expectNoneContain(urls, "Preflabel", "genre=", "label=", `=${split.genre}`);
  });

  test("with only two others coming, no note for anyone", async ({ page }) => {
    const split = await genreSplit();
    const n = await openNight("Small Warn Club", [split.hit, split.miss], ["ana", "ben", "owner"]);
    await prefer(n.members.ana, "genre", String(split.genre), "Preflabel");
    await signInAsUser(page, n.users.owner);
    await page.goto(`/clubs/${n.clubId}`);
    await expect(page.locator("li.nominee")).toHaveCount(2);
    await expect(page.locator(".pref-note")).toHaveCount(0);
  });

  test("a topic preference never produces the note", async ({ page }) => {
    const films = await withDb((db) => db.select().from(schema.films).where(inArray(schema.films.title, ["Hereditary", "Arrival"])));
    const n = await openNight("Topic Warn Club", films as Film[], ["ana", "ben", "cal", "dot"]);
    // TMDB's real "gore" id, on the seeded Hereditary.
    await prefer(n.members.ana, "keyword", "10292", "Gore");
    await signInAsUser(page, n.users.owner);
    await page.goto(`/clubs/${n.clubId}`);
    await expect(page.locator("li.nominee")).toHaveCount(2);
    await expect(page.locator(".pref-note")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("Gore");
  });
});
