import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { readFileSync } from "node:fs";
import * as schema from "../db/schema";
import { DISPLAY_NAME_HISTORY, HISTORY_CLUB_ID, HISTORY_TAKE, MEMBER_USER, MEMBERSHIP_HISTORY } from "../db/seed-fixtures";
import { findSecretLikeKeys } from "../lib/dataExport";
import { LEGAL } from "../lib/legal";
import { expect, test } from "./fixtures";
import { signInAs, signInAsUser } from "./session";

// Download my data (docs/onboarding-spec.md §11.5). Rae, in the seeded
// History Club, already has votes, nominations, RSVPs and a rating with a
// hot take and a tag. This spec gives her what the seed doesn't (a
// watchlist film, a hard limit, a veto, an email change) and takes it
// away afterwards, so History Club looks as seeded to every later spec.
// Sol and Tib are the other members: nothing of theirs may be in her file.
test.describe.configure({ mode: "serial" });

type Db = ReturnType<typeof drizzle<typeof schema>>;
async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = postgres(process.env.E2E_DATABASE_URL!);
  try {
    return await fn(drizzle(client, { schema }));
  } finally {
    await client.end();
  }
}

const RAE = MEMBERSHIP_HISTORY.rae;
const added: { veto?: string; constraint?: string; emailChange?: string; watchlist?: string } = {};

test.describe("Download my data", () => {
  test.beforeAll(async () => {
    await withDb(async (db) => {
      const [whiplash] = await db.select().from(schema.films).where(eq(schema.films.title, "Whiplash"));
      const [thief] = await db.select().from(schema.films).where(eq(schema.films.title, "Thief"));
      const [item] = await db
        .insert(schema.watchlistItems)
        .values({ userId: MEMBER_USER.rae, filmId: thief.id, note: "Rae's note", tags: ["heist"] })
        .returning();
      added.watchlist = item.id;
      const [limit] = await db
        .insert(schema.constraints)
        .values({ membershipId: RAE, kind: "hard", ruleType: "genre", value: "27", label: "Horror" })
        .returning();
      added.constraint = limit.id;
      // A veto of Tib's Whiplash nomination on the unconfirmed night.
      const [nomination] = await db
        .select({ id: schema.nominations.id, nightId: schema.nominations.nightId })
        .from(schema.nominations)
        .where(and(eq(schema.nominations.filmId, whiplash.id), eq(schema.nominations.membershipId, MEMBERSHIP_HISTORY.tib)));
      const [season] = await db.select().from(schema.seasons).where(eq(schema.seasons.clubId, HISTORY_CLUB_ID));
      const [veto] = await db
        .insert(schema.vetoes)
        .values({ nightId: nomination.nightId, nominationId: nomination.id, membershipId: RAE, seasonId: season.id })
        .returning();
      added.veto = veto.id;
      const [change] = await db
        .insert(schema.emailChanges)
        .values({
          userId: MEMBER_USER.rae,
          newEmail: "rae.new@example.com",
          codeHash: "never-exported-code-hash",
          expiresAt: new Date(Date.now() + 600_000),
          cancelledAt: new Date(),
        })
        .returning();
      added.emailChange = change.id;
    });
  });

  test.afterAll(async () => {
    await withDb(async (db) => {
      if (added.veto) await db.delete(schema.vetoes).where(eq(schema.vetoes.id, added.veto));
      if (added.constraint) await db.delete(schema.constraints).where(eq(schema.constraints.id, added.constraint));
      if (added.emailChange) await db.delete(schema.emailChanges).where(eq(schema.emailChanges.id, added.emailChange));
      if (added.watchlist) await db.delete(schema.watchlistItems).where(eq(schema.watchlistItems.id, added.watchlist));
    });
  });

  test("Settings downloads your own data, and nobody else's", async ({ page }) => {
    await signInAs(page, RAE);
    await page.goto("/settings");
    const requested: string[] = [];
    page.on("request", (r) => requested.push(r.url()));
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Download my data" }).click(),
    ]);
    // No query string, ever.
    expect(new URL(download.url()).search).toBe("");
    expect(new URL(download.url()).pathname).toBe("/settings/export");
    expect(requested.filter((u) => u.includes("/settings/export")).every((u) => !u.includes("?"))).toBe(true);
    expect(download.suggestedFilename()).toMatch(/^kinomato-export-\d{4}-\d{2}-\d{2}\.json$/);
    const text = readFileSync((await download.path())!, "utf8");
    const data = JSON.parse(text);

    // Each section holds her own rows.
    expect(data.meta.format_version).toBe(1);
    expect(data.account).toMatchObject({
      email: "rae@example.com",
      display_name: DISPLAY_NAME_HISTORY.rae,
      age_bracket: "18_plus",
    });
    expect(data.consent.documents.map((d: { document: string; version: string }) => [d.document, d.version]).sort()).toEqual([
      ["privacy", LEGAL.privacy.version],
      ["terms", LEGAL.terms.version],
    ]);
    expect(data.clubs).toEqual([expect.objectContaining({ name: "History Club", role: "owner", left_at: null })]);
    expect(data.watchlist).toEqual([
      expect.objectContaining({ film: "Thief", note: "Rae's note", tags: ["heist"] }),
    ]);
    expect(data.ratings).toEqual([
      expect.objectContaining({
        club: "History Club",
        film: "Blade Runner",
        quality: "8.5",
        fun: "9.0",
        hot_take: HISTORY_TAKE.revealed,
        tags: ["Rainy"],
      }),
    ]);
    expect(data.nominations.map((n: { film: string }) => n.film).sort()).toEqual(["Arrival", "Blade Runner", "Hereditary"]);
    expect(data.rsvps.map((r: { status: string }) => r.status)).toEqual(["yes", "yes"]);
    expect(data.limits_and_preferences).toEqual([
      { club: "History Club", kind: "hard", rule_type: "genre", value: "27", label: "Horror", applies_when_absent: false },
    ]);
    // Her own votes: the films she chose. Not Sol's or Tib's.
    expect(data.votes.map((v: { film: string }) => v.film)).toEqual(["Zodiac", "Arrival", "Get Out"]);
    // Her own veto, and not Tib's (Hereditary).
    expect(data.vetoes.map((v: { film: string }) => v.film)).toEqual(["Whiplash"]);
    expect(data.email_change_requests).toEqual([
      expect.objectContaining({ new_email: "rae.new@example.com", confirmed_at: null }),
    ]);

    // Nothing of anyone else's, anywhere in the file: every other member of
    // every club she's in, by name and email.
    const others = await withDb(async (db) => {
      const clubIds = (
        await db.select({ clubId: schema.memberships.clubId }).from(schema.memberships).where(eq(schema.memberships.userId, MEMBER_USER.rae))
      ).map((m) => m.clubId);
      const people = await db
        .selectDistinct({ id: schema.users.id, email: schema.users.email, name: schema.users.displayName })
        .from(schema.memberships)
        .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
        .where(inArray(schema.memberships.clubId, clubIds));
      return people.filter((p) => p.id !== MEMBER_USER.rae);
    });
    expect(others.length).toBeGreaterThanOrEqual(2);
    for (const other of others) {
      expect(text, other.email).not.toContain(other.email);
      if (other.name) expect(text, other.name).not.toContain(other.name);
    }
    // Nor anyone's ids, hashes or tokens.
    expect(findSecretLikeKeys(data)).toEqual([]);
    expect(text).not.toContain("never-exported-code-hash");
    expect(text).not.toContain(RAE);
    expect(text).not.toContain(MEMBER_USER.rae);
  });

  test("the response: JSON, an attachment, never cached", async ({ page }) => {
    await signInAs(page, RAE);
    const response = await page.request.get("/settings/export");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/^application\/json/);
    expect(response.headers()["content-disposition"]).toMatch(
      /^attachment; filename="kinomato-export-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(response.headers()["cache-control"]).toBe("no-store");
  });

  test("signed out goes to /login; with consent pending, to /consent", async ({ page }) => {
    const signedOut = await page.request.get("/settings/export", { maxRedirects: 0 });
    expect(signedOut.status()).toBe(307);
    expect(signedOut.headers()["location"]).toBe(`/login?${new URLSearchParams({ returnTo: "/settings" })}`);

    // A named account that has never accepted the Terms.
    const userId = crypto.randomUUID();
    await withDb((db) =>
      db.insert(schema.users).values({ id: userId, email: "export.pending@example.com", displayName: "Pat E." }),
    );
    await signInAsUser(page, userId);
    const pending = await page.request.get("/settings/export", { maxRedirects: 0 });
    expect(pending.status()).toBe(307);
    expect(pending.headers()["location"]).toBe(`/consent?${new URLSearchParams({ next: "/settings" })}`);
  });
});
