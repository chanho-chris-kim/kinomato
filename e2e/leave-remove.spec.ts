import type { Page } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import { LEGAL } from "../lib/legal";
import { expect, test } from "./fixtures";
import { signInAsUser } from "./session";
import { finishCodeSignIn } from "./signIn";

// Leaving and removal (docs/onboarding-spec.md §5.10, ruled 2026-11-11).
// Each test builds its own club, so no seeded club changes.

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
    const emails: Record<string, string> = {};
    let day = 1;
    for (const p of people) {
      users[p.key] = id();
      members[p.key] = id();
      emails[p.key] = `${p.key}.${clubId.slice(0, 8)}@example.com`;
      await db.insert(schema.users).values({
        id: users[p.key],
        email: emails[p.key],
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
    return { clubId, users, members, emails };
  });
}

const membership = (membershipId: string) =>
  withDb(async (db) => (await db.select().from(schema.memberships).where(eq(schema.memberships.id, membershipId)))[0]);
const inFlight = (clubId: string) =>
  withDb((db) =>
    db
      .select()
      .from(schema.nights)
      .where(and(eq(schema.nights.clubId, clubId), inArray(schema.nights.state, ["draft", "open", "locked"]))),
  );
const watched = (clubId: string, pickerMembershipId: string, ago: number) =>
  withDb((db) =>
    db.insert(schema.nights).values({
      clubId,
      scheduledAt: daysAgo(ago),
      pickerMembershipId,
      state: "watched",
      confirmedAt: daysAgo(ago - 1),
      confirmedBy: pickerMembershipId,
    }),
  );

async function leave(page: Page, clubId: string) {
  await page.goto(`/clubs/${clubId}/members`);
  await page.getByRole("link", { name: "Leave this club" }).click();
}

test.describe("leaving and removal", () => {
  test("a member leaves: the club vanishes from / and 404s, and their history stays", async ({ page }) => {
    const c = await clubWith("Leavers Club", [
      { key: "owner", name: "Oda L.", role: "owner" },
      { key: "mia", name: "Mia L.", role: "member" },
    ]);
    await watched(c.clubId, c.members.mia, 7);

    await signInAsUser(page, c.users.mia);
    await page.goto("/");
    await expect(page.locator(".clubcard", { hasText: "Leavers Club" })).toHaveCount(1);
    await leave(page, c.clubId);
    await expect(page.locator(".leave-confirm")).toContainText(
      "Leave Leavers Club? Your past picks, votes and ratings stay in its history.",
    );
    await page.locator(".leave-confirm").getByRole("button", { name: "Leave", exact: true }).click();
    await expect(page).toHaveURL("/");
    await expect(page.locator(".clubcard", { hasText: "Leavers Club" })).toHaveCount(0);
    for (const path of ["", "/members", "/history"]) {
      expect((await page.request.get(`/clubs/${c.clubId}${path}`)).status(), path).toBe(404);
    }
    expect((await membership(c.members.mia)).leftAt).not.toBeNull();

    await signInAsUser(page, c.users.owner);
    await page.goto(`/clubs/${c.clubId}/history`);
    await expect(page.locator("main")).toContainText("Mia L.'s pick");
  });

  test("the owner leaves: the named heir takes over, or the one they choose", async ({ page }) => {
    const a = await clubWith("Heir Club", [
      { key: "owner", name: "Ori H.", role: "owner" },
      { key: "mo", name: "Mo H.", role: "member" },
      { key: "ada", name: "Ada H.", role: "admin" },
    ]);
    await signInAsUser(page, a.users.owner);
    await leave(page, a.clubId);
    // An admin before an earlier member: the account-deletion rule.
    await expect(page.locator(".leave-confirm")).toContainText("Ada H. will become the owner.");
    await page.locator(".leave-confirm").getByRole("button", { name: "Leave", exact: true }).click();
    await expect(page).toHaveURL("/");
    expect((await membership(a.members.ada)).role).toBe("owner");
    const gone = await membership(a.members.owner);
    expect([gone.role, gone.leftAt !== null]).toEqual(["member", true]);

    const b = await clubWith("Chooser Club", [
      { key: "owner", name: "Oki C.", role: "owner" },
      { key: "ace", name: "Ace C.", role: "admin" },
      { key: "max", name: "Max C.", role: "member" },
    ]);
    await signInAsUser(page, b.users.owner);
    await leave(page, b.clubId);
    await expect(page.locator(".leave-confirm")).toContainText("Ace C. will become the owner.");
    await page.getByRole("button", { name: "Leave and make Max C. the owner" }).click();
    await expect(page).toHaveURL("/");
    expect((await membership(b.members.max)).role).toBe("owner");
    expect((await membership(b.members.ace)).role).toBe("admin");
    expect((await membership(b.members.owner)).leftAt).not.toBeNull();
  });

  test("the last member can pause or delete, and deleting takes the whole club", async ({ page }) => {
    const c = await clubWith("Solo Leave Club", [{ key: "owner", name: "Ona S.", role: "owner" }]);
    await watched(c.clubId, c.members.owner, 7);
    await withDb((db) =>
      db.insert(schema.invites).values({
        clubId: c.clubId,
        token: `solo-leave-${id()}`,
        inviteeName: "Pat P.",
        invitedByMembershipId: c.members.owner,
      }),
    );
    await signInAsUser(page, c.users.owner);
    await leave(page, c.clubId);
    const confirm = page.locator(".leave-confirm");
    await expect(confirm).toContainText("You're the last member of Solo Leave Club");
    await expect(confirm.getByRole("button", { name: "Pause the club" })).toBeVisible();
    await expect(confirm.getByRole("button", { name: "Leave", exact: true })).toHaveCount(0);

    await confirm.getByLabel(/type its name/).fill("solo leave club");
    await confirm.getByRole("button", { name: "Delete this club" }).click();
    await expect(page.locator("#leave").getByRole("alert")).toHaveText("That isn't the club's name exactly.");
    expect((await withDb((db) => db.select().from(schema.clubs).where(eq(schema.clubs.id, c.clubId)))).length).toBe(1);

    await page.locator(".leave-confirm").getByLabel(/type its name/).fill("Solo Leave Club");
    await page.locator(".leave-confirm").getByRole("button", { name: "Delete this club" }).click();
    await expect(page).toHaveURL("/");
    const left = await withDb(async (db) => ({
      clubs: await db.select().from(schema.clubs).where(eq(schema.clubs.id, c.clubId)),
      memberships: await db.select().from(schema.memberships).where(eq(schema.memberships.clubId, c.clubId)),
      nights: await db.select().from(schema.nights).where(eq(schema.nights.clubId, c.clubId)),
      invites: await db.select().from(schema.invites).where(eq(schema.invites.clubId, c.clubId)),
      seasons: await db.select().from(schema.seasons).where(eq(schema.seasons.clubId, c.clubId)),
      tags: await db.select().from(schema.tags).where(eq(schema.tags.clubId, c.clubId)),
    }));
    for (const [table, rows] of Object.entries(left)) expect(rows, table).toEqual([]);
  });

  test("owner removes an admin, an admin removes a member, an admin can't remove an admin", async ({ page, browser }) => {
    const c = await clubWith("Remove Club", [
      { key: "owner", name: "Oto R.", role: "owner" },
      { key: "ari", name: "Ari R.", role: "admin" },
      { key: "bea", name: "Bea R.", role: "admin" },
      { key: "mac", name: "Mac R.", role: "member" },
    ]);
    const url = `/clubs/${c.clubId}/members`;

    // An admin: Remove on plain members only.
    await signInAsUser(page, c.users.ari);
    await page.goto(url);
    await expect(page.getByRole("link", { name: "Remove Mac R. from the club" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Remove Bea R. from the club" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Remove Oto R. from the club" })).toHaveCount(0);
    await page.getByRole("link", { name: "Remove Mac R. from the club" }).click();
    await expect(page.locator(".remove-confirm")).toContainText(
      "Remove Mac R. from Remove Club? Their past picks, votes and ratings stay in its history.",
    );
    await page.locator(".remove-confirm").getByRole("button", { name: "Remove" }).click();
    await expect(page.locator("main").getByRole("status").first()).toHaveText("Removed.");
    expect((await membership(c.members.mac)).leftAt).not.toBeNull();

    // An admin's post against another admin: refused, nothing changes. The
    // owner's confirm loaded, then demoted to admin, then the click.
    const context = await browser.newContext();
    try {
      const stale = await context.newPage();
      await signInAsUser(stale, c.users.owner);
      await stale.goto(`${url}?remove=${c.members.bea}`);
      await expect(stale.locator(".remove-confirm")).toBeVisible();
      await withDb((db) =>
        db.update(schema.memberships).set({ role: "admin" }).where(eq(schema.memberships.id, c.members.owner)),
      );
      const response = stale.waitForResponse((r) => r.request().method() === "POST");
      await stale.locator(".remove-confirm").getByRole("button", { name: "Remove" }).click();
      expect((await response).status()).toBe(500);
    } finally {
      await context.close();
    }
    expect((await membership(c.members.bea)).leftAt).toBeNull();
    await withDb((db) =>
      db.update(schema.memberships).set({ role: "owner" }).where(eq(schema.memberships.id, c.members.owner)),
    );

    // The owner removes an admin.
    await signInAsUser(page, c.users.owner);
    await page.goto(url);
    await page.getByRole("link", { name: "Remove Bea R. from the club" }).click();
    await page.locator(".remove-confirm").getByRole("button", { name: "Remove" }).click();
    await expect(page.locator("main").getByRole("status").first()).toHaveText("Removed.");
    expect((await membership(c.members.bea)).leftAt).not.toBeNull();
    // No Remove on the owner's own card.
    await expect(page.getByRole("link", { name: "Remove Oto R. from the club" })).toHaveCount(0);

    // Removed people see the club vanish and its pages 404.
    await signInAsUser(page, c.users.mac);
    await page.goto("/");
    await expect(page.locator(".clubcard", { hasText: "Remove Club" })).toHaveCount(0);
    expect((await page.request.get(`/clubs/${c.clubId}`)).status()).toBe(404);
  });

  test("a removed person re-invited rejoins without jumping the queue", async ({ page, browser }) => {
    const c = await clubWith("Queue Club", [
      { key: "owner", name: "Odin Q.", role: "owner" },
      { key: "pip", name: "Pip Q.", role: "member" },
      { key: "quy", name: "Quy Q.", role: "member" },
    ]);
    // Last picks: Odin 14 days ago, Pip 7, Quy 3. Next up: Odin.
    await watched(c.clubId, c.members.owner, 14);
    await watched(c.clubId, c.members.pip, 7);
    await watched(c.clubId, c.members.quy, 3);

    await signInAsUser(page, c.users.owner);
    await page.goto(`/clubs/${c.clubId}/members?remove=${c.members.pip}`);
    await page.locator(".remove-confirm").getByRole("button", { name: "Remove" }).click();
    await expect(page.locator("main").getByRole("status").first()).toHaveText("Removed.");

    // A fresh personal invite; Pip signs in through it and rejoins.
    const token = `queue-${id()}`;
    await withDb((db) =>
      db.insert(schema.invites).values({
        clubId: c.clubId,
        token,
        inviteeName: "Pip Q.",
        invitedByMembershipId: c.members.owner,
      }),
    );
    const context = await browser.newContext();
    try {
      const pip = await context.newPage();
      await pip.goto(`/invite/${token}`);
      await pip.getByLabel("Your email").fill(c.emails.pip);
      await pip.getByRole("button", { name: "Continue" }).click();
      await finishCodeSignIn(pip, c.emails.pip);
      await expect(pip).toHaveURL(new RegExp(`/clubs/${c.clubId}`));
    } finally {
      await context.close();
    }
    const rows = await withDb((db) =>
      db.select().from(schema.memberships).where(eq(schema.memberships.userId, c.users.pip)),
    );
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.leftAt === null)).toHaveLength(1);

    // A brand-new membership would sort first (never picked). Carried
    // forward, Pip's pick from a week ago keeps Odin next.
    await page.goto(`/clubs/${c.clubId}`);
    const [draft] = await inFlight(c.clubId);
    expect(draft.pickerMembershipId).toBe(c.members.owner);
  });

  test("the picker of an empty draft leaves: the next Tonight load drafts for the next person", async ({ page }) => {
    const c = await clubWith("Draft Club", [
      { key: "owner", name: "Oslo D.", role: "owner" },
      { key: "pia", name: "Pia D.", role: "member" },
      { key: "rio", name: "Rio D.", role: "member" },
    ]);
    // Oslo picked last week, so Pia (never picked, joined before Rio) is up.
    await watched(c.clubId, c.members.owner, 7);
    await signInAsUser(page, c.users.owner);
    await page.goto(`/clubs/${c.clubId}`);
    const [draft] = await inFlight(c.clubId);
    expect(draft.pickerMembershipId).toBe(c.members.pia);
    await withDb((db) =>
      db.insert(schema.rsvps).values({ nightId: draft.id, membershipId: c.members.rio, status: "yes" }),
    );

    await signInAsUser(page, c.users.pia);
    await leave(page, c.clubId);
    await page.locator(".leave-confirm").getByRole("button", { name: "Leave", exact: true }).click();
    await expect(page).toHaveURL("/");
    // The empty draft went with her, its RSVPs first.
    expect(await withDb((db) => db.select().from(schema.nights).where(eq(schema.nights.id, draft.id)))).toEqual([]);

    await signInAsUser(page, c.users.owner);
    await page.goto(`/clubs/${c.clubId}`);
    const [next] = await inFlight(c.clubId);
    expect(next.pickerMembershipId).toBe(c.members.rio);
    await expect(page.locator("main")).toContainText("Rio D.");
  });

  test("the picker of an open night leaves: it carries on, and an admin can lock it", async ({ page }) => {
    const c = await clubWith("Open Club", [
      { key: "owner", name: "Opal O.", role: "owner" },
      { key: "ada", name: "Ada O.", role: "admin" },
      { key: "pax", name: "Pax O.", role: "member" },
    ]);
    const nightId = await withDb(async (db) => {
      const films = await db.select().from(schema.films).limit(2);
      const [night] = await db
        .insert(schema.nights)
        .values({
          clubId: c.clubId,
          scheduledAt: new Date(Date.now() + 2 * 86_400_000),
          pickerMembershipId: c.members.pax,
          state: "open",
        })
        .returning();
      await db
        .insert(schema.nominations)
        .values(films.map((f) => ({ nightId: night.id, filmId: f.id, membershipId: c.members.pax })));
      return night.id;
    });

    await signInAsUser(page, c.users.pax);
    await leave(page, c.clubId);
    await page.locator(".leave-confirm").getByRole("button", { name: "Leave", exact: true }).click();
    await expect(page).toHaveURL("/");
    const [still] = await inFlight(c.clubId);
    expect([still.id, still.state]).toEqual([nightId, "open"]);

    await signInAsUser(page, c.users.ada);
    await page.goto(`/clubs/${c.clubId}`);
    // The departed picker is still named while the night carries on.
    await expect(page.locator("main")).toContainText("Pax O.");
    await page.getByRole("button", { name: "Close voting and set the pick" }).click();
    await expect.poll(async () => (await inFlight(c.clubId))[0]?.state).toBe("locked");
  });
});
