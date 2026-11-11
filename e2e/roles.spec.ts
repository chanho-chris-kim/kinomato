import type { Browser, Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import { LEGAL } from "../lib/legal";
import { expect, test } from "./fixtures";
import { signInAsUser } from "./session";

// Roles and ownership (docs/onboarding-spec.md §5.10, ruled 2026-11-11):
// only the owner makes or removes admins and hands the club on, through a
// two-tap confirm; the old owner becomes an admin. Admins and members
// change nobody's role. Each test builds its own club.

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
type Role = "owner" | "admin" | "member" | "guest";

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

const rolesOf = (ids: string[]) =>
  withDb(async (db) =>
    Object.fromEntries(
      (await db.select().from(schema.memberships).where(inArray(schema.memberships.id, ids))).map((m) => [m.id, m.role]),
    ),
  );
const setRole = (membershipId: string, role: Role) =>
  withDb((db) => db.update(schema.memberships).set({ role }).where(eq(schema.memberships.id, membershipId)));

const roleControls = (page: Page) => page.locator("main .role-controls");
const ownerAdminControls = async (page: Page, visible: boolean) => {
  const count = visible ? 1 : 0;
  await expect(page.getByRole("button", { name: "Save details" })).toHaveCount(count);
  await expect(page.locator("main").getByRole("heading", { name: "Add a person" })).toHaveCount(count);
};

// A post from someone the rules don't allow, the way a stale page sends
// one: their controls loaded as owner, then their role changed, then the
// click. Refused with a 500. Its own context: the refused action errors.
async function refused(browser: Browser, userId: string, url: string, before: () => Promise<unknown>, click: (p: Page) => Promise<void>) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await signInAsUser(page, userId);
    await page.goto(url);
    await before();
    const response = page.waitForResponse((r) => r.request().method() === "POST");
    await click(page);
    expect((await response).status()).toBe(500);
  } finally {
    await context.close();
  }
}

test.describe("roles", () => {
  test("the owner makes a member an admin, who gets the owner/admin controls; removing admin takes them away", async ({
    page,
  }) => {
    const c = await clubWith("Admin Club", [
      { key: "owner", name: "Orla R.", role: "owner" },
      { key: "mel", name: "Mel R.", role: "member" },
      { key: "gil", name: "Gil R.", role: "guest" },
    ]);
    const url = `/clubs/${c.clubId}/members`;

    await signInAsUser(page, c.users.mel);
    await page.goto(url);
    await ownerAdminControls(page, false);

    await signInAsUser(page, c.users.owner);
    await page.goto(url);
    // Roles in words; the leftover guest reads as Member, and its only
    // promotion is admin.
    const gil = page.locator("main li.card", { hasText: "Gil R." });
    await expect(gil.locator(".member-role")).toHaveText("Member");
    await expect(gil.getByRole("button", { name: "Make Gil R. an admin" })).toBeVisible();
    await expect(gil.getByRole("button", { name: "Remove Gil R. as admin" })).toHaveCount(0);
    // The owner's own card has no controls.
    await expect(page.locator("main li.card", { hasText: "Orla R. (you)" }).locator(".role-controls")).toHaveCount(0);

    await page.getByRole("button", { name: "Make Mel R. an admin" }).click();
    await expect(page.locator("main").getByRole("status").first()).toHaveText("Saved.");
    await expect(page.locator("main li.card", { hasText: "Mel R." }).locator(".member-role")).toHaveText("Admin");
    expect((await rolesOf([c.members.mel]))[c.members.mel]).toBe("admin");

    await signInAsUser(page, c.users.mel);
    await page.goto(url);
    await ownerAdminControls(page, true);
    // Still no role controls for an admin.
    await expect(roleControls(page)).toHaveCount(0);

    await signInAsUser(page, c.users.owner);
    await page.goto(url);
    await page.getByRole("button", { name: "Remove Mel R. as admin" }).click();
    await expect(page.locator("main li.card", { hasText: "Mel R." }).locator(".member-role")).toHaveText("Member");

    await signInAsUser(page, c.users.mel);
    await page.goto(url);
    await ownerAdminControls(page, false);
  });

  test("admins and members see no role controls; their posts are refused, nothing changes", async ({ page, browser }) => {
    const c = await clubWith("Quiet Club", [
      { key: "owner", name: "Odo Q.", role: "owner" },
      { key: "ada", name: "Ada Q.", role: "admin" },
      { key: "max", name: "Max Q.", role: "member" },
    ]);
    const url = `/clubs/${c.clubId}/members`;
    for (const who of [c.users.ada, c.users.max]) {
      await signInAsUser(page, who);
      await page.goto(url);
      await expect(page.locator("main li.card")).toHaveCount(3);
      await expect(roleControls(page)).toHaveCount(0);
      await expect(page.getByRole("link", { name: /the owner$/ })).toHaveCount(0);
    }

    // As an admin: make admin.
    await refused(
      browser,
      c.users.owner,
      url,
      () => setRole(c.members.owner, "admin"),
      (p) => p.getByRole("button", { name: "Make Max Q. an admin" }).click(),
    );
    // As a member: hand the club on, from its confirm card.
    await setRole(c.members.owner, "owner");
    await refused(
      browser,
      c.users.owner,
      `${url}?transfer=${c.members.max}`,
      () => setRole(c.members.owner, "member"),
      (p) => p.locator(".transfer-confirm").getByRole("button", { name: "Make owner" }).click(),
    );
    expect(await rolesOf(Object.values(c.members))).toEqual({
      [c.members.owner]: "member",
      [c.members.ada]: "admin",
      [c.members.max]: "member",
    });
  });

  test("a transfer: named confirm, cancel changes nothing, confirm swaps owner and admin", async ({ page }) => {
    const c = await clubWith("Saturday Club", [
      { key: "owner", name: "Olu S.", role: "owner" },
      { key: "sam", name: "Sam K.", role: "member" },
    ]);
    const url = `/clubs/${c.clubId}/members`;
    await signInAsUser(page, c.users.owner);
    await page.goto(url);

    await page.getByRole("link", { name: "Make Sam K. the owner" }).click();
    const confirm = page.locator(".transfer-confirm");
    await expect(confirm).toContainText("Make Sam K. the owner of Saturday Club? You'll become an admin.");
    // The confirm URL carries a membership id, never a name.
    expect(page.url()).toContain(`transfer=${c.members.sam}`);
    expect(decodeURIComponent(page.url())).not.toContain("Sam");

    await confirm.getByRole("link", { name: "Cancel" }).click();
    await expect(page.locator(".transfer-confirm")).toHaveCount(0);
    expect(await rolesOf([c.members.owner, c.members.sam])).toEqual({
      [c.members.owner]: "owner",
      [c.members.sam]: "member",
    });

    await page.getByRole("link", { name: "Make Sam K. the owner" }).click();
    await page.locator(".transfer-confirm").getByRole("button", { name: "Make owner" }).click();
    await expect(page.locator("main").getByRole("status").first()).toHaveText("Done. You're an admin now.");
    expect(await rolesOf([c.members.owner, c.members.sam])).toEqual({
      [c.members.owner]: "admin",
      [c.members.sam]: "owner",
    });
    // The old owner, now an admin: no role controls, still admin controls.
    await expect(roleControls(page)).toHaveCount(0);
    await ownerAdminControls(page, true);

    // The new owner has them.
    await signInAsUser(page, c.users.sam);
    await page.goto(url);
    await expect(page.getByRole("button", { name: "Remove Olu S. as admin" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Make Olu S. the owner" })).toBeVisible();
  });

  test("handing the club to someone who has since left is refused", async ({ page }) => {
    const c = await clubWith("Leaving Club", [
      { key: "owner", name: "Oz L.", role: "owner" },
      { key: "lee", name: "Lee L.", role: "member" },
    ]);
    await signInAsUser(page, c.users.owner);
    await page.goto(`/clubs/${c.clubId}/members?transfer=${c.members.lee}`);
    await expect(page.locator(".transfer-confirm")).toContainText("Make Lee L. the owner of Leaving Club?");
    await withDb((db) =>
      db.update(schema.memberships).set({ leftAt: new Date() }).where(eq(schema.memberships.id, c.members.lee)),
    );
    await page.locator(".transfer-confirm").getByRole("button", { name: "Make owner" }).click();
    await expect(page.locator("main").getByRole("alert")).toHaveText("That person isn't in the club any more.");
    expect(await rolesOf([c.members.owner, c.members.lee])).toEqual({
      [c.members.owner]: "owner",
      [c.members.lee]: "member",
    });
    // And a confirm link for them no longer shows a confirm card.
    await page.goto(`/clubs/${c.clubId}/members?transfer=${c.members.lee}`);
    await expect(page.locator(".transfer-confirm")).toHaveCount(0);
  });
});
