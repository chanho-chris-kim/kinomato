import type { Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import { LEGAL } from "../lib/legal";
import { MOVIE_GENRES } from "../lib/constraintForm";
import { expect, test } from "./fixtures";
import { signInAsUser } from "./session";
import { expectNoneContain, recordRequestUrls } from "./signIn";

// "Your limits in this club" (docs/onboarding-spec.md §5.10, ruled
// 2026-11-12): only the person sees and changes their own limits; two hard
// limits each; the "weeks I'm out" switch is one per person. Each test
// builds its own club.

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

const limitsOf = (membershipId: string) =>
  withDb((db) => db.select().from(schema.constraints).where(eq(schema.constraints.membershipId, membershipId)));
const section = (page: Page) => page.locator("#limits");
const chips = (page: Page) => page.locator("#limits .my-limits .chip");

async function addLimit(page: Page, kind: "Hard limit" | "Prefer not", what: { genre: string } | { minutes: string }) {
  const form = page.locator("form.limit-form");
  await form.getByRole("radio", { name: kind, exact: true }).check();
  if ("genre" in what) {
    await form.getByRole("radio", { name: "A genre", exact: true }).check();
    await form.locator('select[name="genre"]').selectOption({ label: what.genre });
  } else {
    await form.getByRole("radio", { name: "A length", exact: true }).check();
    await form.getByLabel("Nothing over (minutes)").fill(what.minutes);
  }
  await form.getByRole("button", { name: "Add" }).click();
}

// A genre two seeded films have, and a seeded film without it.
async function genreSplit() {
  return withDb(async (db) => {
    const all = (await db.select().from(schema.films)).filter((f) => f.genreIds.length > 0);
    for (const g of MOVIE_GENRES) {
      const hit = all.filter((f) => f.genreIds.includes(g.id));
      const miss = all.filter((f) => !f.genreIds.includes(g.id));
      if (hit.length >= 1 && miss.length >= 2) return { genre: g, hit: hit[0], miss: miss.slice(0, 2) };
    }
    throw new Error("No listed genre splits the seeded films.");
  });
}

test.describe("Your limits in this club", () => {
  test("add, see, remove; the cap holds against the form and a forged post; duplicates refused; nothing in a URL", async ({
    page,
  }) => {
    const c = await clubWith("Limits Club", [
      { key: "owner", name: "Oona M.", role: "owner" },
      { key: "mia", name: "Mia M.", role: "member" },
    ]);
    const urls = recordRequestUrls(page);
    await signInAsUser(page, c.users.mia);
    await page.goto(`/clubs/${c.clubId}/members`);
    await expect(section(page)).toContainText("These apply in Limits Club only. Two hard limits each.");
    await expect(section(page)).toContainText("A change counts from the next time films are checked");
    await expect(section(page)).toContainText("No limits set for this club.");
    // No switch until there's a limit.
    await expect(page.getByRole("switch")).toHaveCount(0);

    await addLimit(page, "Hard limit", { genre: "Western" });
    await addLimit(page, "Hard limit", { minutes: "120" });
    await addLimit(page, "Prefer not", { genre: "Romance" });
    await expect(chips(page)).toHaveText(["Hard limit: Western", "Hard limit: Nothing over 2h", "Prefer not: Romance"]);
    expect((await limitsOf(c.members.mia)).map((r) => [r.kind, r.ruleType, r.value]).sort()).toEqual([
      ["hard", "genre", "37"],
      ["hard", "runtime", "120"],
      ["soft", "genre", "10749"],
    ]);

    // At two hard limits the form says so and only offers a preference.
    await expect(page.locator(".limit-cap")).toHaveText("You have two hard limits. Remove one, or add this as a preference.");
    await expect(page.locator("form.limit-form").getByRole("radio", { name: "Hard limit", exact: true })).toBeDisabled();
    // A forged third: refused on the server with the same message.
    const form = page.locator("form.limit-form");
    await form.getByRole("radio", { name: "Hard limit", exact: true }).evaluate((el) => {
      (el as HTMLInputElement).disabled = false;
      (el as HTMLInputElement).checked = true;
    });
    await form.locator('select[name="genre"]').selectOption({ label: "Thriller" });
    await form.getByRole("button", { name: "Add" }).click();
    await expect(section(page).getByRole("alert")).toHaveText(
      "You have two hard limits. Remove one, or add this as a preference.",
    );
    expect((await limitsOf(c.members.mia)).filter((r) => r.kind === "hard")).toHaveLength(2);

    // A duplicate, even as the other kind.
    await addLimit(page, "Prefer not", { genre: "Western" });
    await expect(section(page).getByRole("alert")).toHaveText("You already have that one.");
    expect(await limitsOf(c.members.mia)).toHaveLength(3);

    // Remove one.
    await page.getByRole("button", { name: "Remove Hard limit: Nothing over 2h" }).click();
    await expect(chips(page)).toHaveText(["Hard limit: Western", "Prefer not: Romance"]);
    await expect(page.locator(".limit-cap")).toHaveCount(0);

    // No limit value or label ever in a URL.
    expectNoneContain(urls, "Western", "Romance", "Thriller", "genre=", "minutes=", "label=", "keyword=");
  });

  test("nobody else sees your limits: not the owner, an admin or a member, anywhere", async ({ page }) => {
    const c = await clubWith("Private Limits Club", [
      { key: "owner", name: "Odin P.", role: "owner" },
      { key: "ada", name: "Ada P.", role: "admin" },
      { key: "max", name: "Max P.", role: "member" },
      { key: "liv", name: "Liv P.", role: "member" },
    ]);
    await signInAsUser(page, c.users.liv);
    await page.goto(`/clubs/${c.clubId}/members`);
    await addLimit(page, "Hard limit", { genre: "Western" });
    await addLimit(page, "Prefer not", { minutes: "150" });
    await expect(chips(page)).toHaveCount(2);

    for (const who of [c.users.owner, c.users.ada, c.users.max]) {
      await signInAsUser(page, who);
      for (const path of [`/clubs/${c.clubId}/members`, `/clubs/${c.clubId}`, `/clubs/${c.clubId}/history`, "/", "/settings"]) {
        await page.goto(path);
        // What Liv's chips say, anywhere on the page. ("Western" alone is
        // fine: it's an option in everyone's own add form.)
        await expect(page.locator("body"), `${who} ${path}`).not.toContainText("Hard limit: Western");
        await expect(page.locator("body"), `${who} ${path}`).not.toContainText(/Prefer not: Nothing over \d/);
      }
      await page.goto(`/clubs/${c.clubId}/members`);
      await expect(section(page)).toContainText("No limits set for this club.");
    }
  });

  test("removing someone else's limit is refused, unchanged", async ({ page, browser }) => {
    const c = await clubWith("Forged Remove Club", [
      { key: "owner", name: "Ori F.", role: "owner" },
      { key: "fay", name: "Fay F.", role: "member" },
    ]);
    await signInAsUser(page, c.users.owner);
    await page.goto(`/clubs/${c.clubId}/members`);
    await addLimit(page, "Hard limit", { genre: "Western" });
    const [mine] = await limitsOf(c.members.owner);

    // The owner's Remove button loaded, then that limit made Fay's: the post
    // now names someone else's limit.
    const context = await browser.newContext();
    try {
      const stale = await context.newPage();
      await signInAsUser(stale, c.users.owner);
      await stale.goto(`/clubs/${c.clubId}/members`);
      await withDb((db) =>
        db.update(schema.constraints).set({ membershipId: c.members.fay }).where(eq(schema.constraints.id, mine.id)),
      );
      const response = stale.waitForResponse((r) => r.request().method() === "POST");
      await stale.getByRole("button", { name: "Remove Hard limit: Western" }).click();
      expect((await response).status()).toBe(500);
    } finally {
      await context.close();
    }
    const [still] = await limitsOf(c.members.fay);
    expect(still.id).toBe(mine.id);
  });

  test("a hard limit set here hides that genre from the next picker's list", async ({ page }) => {
    const split = await genreSplit();
    const c = await clubWith("Picker Limits Club", [
      { key: "owner", name: "Oslo K.", role: "owner" },
      { key: "pia", name: "Pia K.", role: "member" },
    ]);
    await withDb(async (db) => {
      await db.insert(schema.watchlistItems).values([
        { userId: c.users.pia, filmId: split.hit.id },
        { userId: c.users.pia, filmId: split.miss[0].id },
      ]);
      await db.insert(schema.nights).values({
        clubId: c.clubId,
        scheduledAt: new Date(Date.now() + 2 * 86_400_000),
        pickerMembershipId: c.members.pia,
        state: "draft",
      });
    });

    await signInAsUser(page, c.users.pia);
    await page.goto(`/clubs/${c.clubId}`);
    await expect(page.locator("main")).toContainText(split.hit.title);

    await signInAsUser(page, c.users.owner);
    await page.goto(`/clubs/${c.clubId}/members`);
    await addLimit(page, "Hard limit", { genre: split.genre.label });

    await signInAsUser(page, c.users.pia);
    await page.goto(`/clubs/${c.clubId}`);
    await expect(page.locator("main")).toContainText(split.miss[0].title);
    await expect(page.locator("main")).not.toContainText(split.hit.title);
  });

  test("the weeks-I'm-out switch writes every row, and an RSVP no no longer lifts the limit at lock", async ({ page }) => {
    const split = await genreSplit();
    const c = await clubWith("Absent Club", [
      { key: "owner", name: "Opal A.", role: "owner" },
      { key: "vee", name: "Vee A.", role: "member" },
      { key: "dee", name: "Dee A.", role: "member" },
    ]);
    await signInAsUser(page, c.users.dee);
    await page.goto(`/clubs/${c.clubId}/members`);
    await addLimit(page, "Hard limit", { genre: split.genre.label });
    await addLimit(page, "Prefer not", { minutes: "200" });
    const toggle = page.getByRole("switch", { name: "Apply my limits even on weeks I'm out" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(page.getByRole("switch", { name: "Apply my limits even on weeks I'm out" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect((await limitsOf(c.members.dee)).map((r) => r.appliesWhenAbsent)).toEqual([true, true]);
    // A new row copies the switch.
    await addLimit(page, "Prefer not", { genre: "Romance" });
    expect((await limitsOf(c.members.dee)).every((r) => r.appliesWhenAbsent)).toBe(true);

    // An open night where the excluded film would win; Dee says no.
    const nightId = await withDb(async (db) => {
      const [night] = await db
        .insert(schema.nights)
        .values({ clubId: c.clubId, scheduledAt: new Date(Date.now() + 2 * 86_400_000), pickerMembershipId: c.members.owner, state: "open" })
        .returning();
      const [hitId, missId] = [id(), id()].sort();
      await db.insert(schema.nominations).values([
        { id: hitId, nightId: night.id, filmId: split.hit.id, membershipId: c.members.owner },
        { id: missId, nightId: night.id, filmId: split.miss[0].id, membershipId: c.members.owner },
      ]);
      await db.insert(schema.votes).values([
        { nominationId: hitId, membershipId: c.members.vee },
        { nominationId: hitId, membershipId: c.members.dee },
        { nominationId: missId, membershipId: c.members.owner },
      ]);
      await db.insert(schema.rsvps).values({ nightId: night.id, membershipId: c.members.dee, status: "no" });
      return night.id;
    });
    await signInAsUser(page, c.users.owner);
    await page.goto(`/clubs/${c.clubId}`);
    await page.getByRole("button", { name: "Close voting and set the pick" }).click();
    const row = async () =>
      (await withDb((db) => db.select().from(schema.nights).where(and(eq(schema.nights.id, nightId)))))[0];
    await expect.poll(async () => (await row()).state).toBe("locked");
    expect((await row()).winningFilmId).toBe(split.miss[0].id);
  });
});
