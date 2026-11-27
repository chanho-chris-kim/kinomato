import type { Page } from "@playwright/test";
import { neon } from "@neondatabase/serverless";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../db/schema";
import { generateInviteToken } from "../lib/invites";
import { LEGAL } from "../lib/legal";
import { expect, test } from "./fixtures";
import { signInAsUser } from "./session";
import { agreeToTerms, finishCodeSignIn } from "./signIn";

// Display name (ruled 2026-11-25, built u2): one free-text name, trimmed,
// 1–30 characters, unique within each club, case-insensitively, among
// active members. Joining with a name someone in the club already has asks
// for another and creates nothing; a rename must be free in every club,
// naming the first that clashes; someone who has left frees their name.

const db = drizzle(neon(process.env.E2E_DATABASE_URL!), { schema });
const id = () => crypto.randomUUID();
const at = new Date(Date.UTC(2026, 0, 1));

async function person(displayName: string | null, tag: string) {
  const userId = id();
  await db.insert(schema.users).values({
    id: userId,
    email: `${tag}.${userId.slice(0, 8)}@example.com`,
    displayName,
    ageBracket: "18_plus",
    ageAttestedAt: at,
  });
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

// A club with an owner and these members (user ids), joined in that order.
async function club(name: string, ownerId: string, memberIds: string[] = []) {
  const clubId = id();
  await db.insert(schema.clubs).values({
    id: clubId,
    name,
    cadence: "ad_hoc",
    timezone: "America/New_York",
    mode: "in_person",
  });
  const ownerMembership = id();
  await db.insert(schema.memberships).values({ id: ownerMembership, clubId, userId: ownerId, role: "owner", joinedAt: at });
  for (const [i, userId] of memberIds.entries()) {
    await db.insert(schema.memberships).values({
      clubId,
      userId,
      role: "member",
      joinedAt: new Date(at.getTime() + (i + 1) * 86_400_000),
    });
  }
  return { clubId, ownerMembership };
}

async function invite(clubId: string, ownerMembership: string, inviteeName: string) {
  const token = generateInviteToken();
  const [row] = await db
    .insert(schema.invites)
    .values({ clubId, token, inviteeName, invitedByMembershipId: ownerMembership })
    .returning();
  return { token, inviteId: row.id };
}

const userByEmail = async (email: string) =>
  (await db.select().from(schema.users).where(eq(schema.users.email, email)))[0];
const activeMemberships = (clubId: string) =>
  db.select().from(schema.memberships).where(and(eq(schema.memberships.clubId, clubId), isNull(schema.memberships.leftAt)));
const inviteRow = async (inviteId: string) =>
  (await db.select().from(schema.invites).where(eq(schema.invites.id, inviteId)))[0];

// From an invite link to the name step, as a brand-new account.
async function toNameStep(page: Page, token: string, email: string) {
  await page.goto(`/invite/${token}`);
  await page.getByLabel("Your email").fill(email);
  await page.getByRole("button", { name: "Send my code" }).click();
  await finishCodeSignIn(page, email);
  await expect(page).toHaveURL(/\/welcome/);
}

test.describe("display name", () => {
  test("signing up sets a free-text display name, trimmed, prefilled from the invite's greeting", async ({ browser }) => {
    const ownerId = await person("Ola O.", "dn-owner");
    const c = await club("Nickname Club", ownerId);
    const { token } = await invite(c.clubId, c.ownerMembership, "Big Al");
    const email = `dn.nick.${id().slice(0, 8)}@example.com`;
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await toNameStep(page, token, email);
      await expect(page.getByLabel("Display name")).toHaveValue("Big Al");
      await expect(page.getByText("How you'll show up in your clubs. A nickname is fine. You can change it in Settings.")).toBeVisible();
      await page.getByLabel("Display name").fill("   Alfie   the  Great  ");
      await agreeToTerms(page);
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page).toHaveURL(`/clubs/${c.clubId}/welcome`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("You're in, Alfie the Great");
      await page.goto(`/clubs/${c.clubId}`);
      expect((await userByEmail(email)).displayName).toBe("Alfie the Great");

      // Everywhere a name shows: the rail, Members, and the export.
      await expect(page.getByRole("complementary", { name: "Club context" })).toContainText("Alfie the Great (you)");
      await page.goto(`/clubs/${c.clubId}/members`);
      await expect(page.locator("main .people-list .person-name").filter({ hasText: "(you)" })).toHaveText(["Alfie the Great (you)"]);
      const exported = await (await page.request.get("/settings/export")).json();
      expect(exported.account.display_name).toBe("Alfie the Great");
    } finally {
      await context.close();
    }
  });

  test("joining with a name someone in the club has asks for another and creates nothing; case and spaces don't get round it", async ({
    browser,
  }) => {
    const ownerId = await person("Ola O.", "dn-owner");
    const benId = await person("Ben B.", "dn-ben");
    const c = await club("Clash Club", ownerId, [benId]);
    const { token, inviteId } = await invite(c.clubId, c.ownerMembership, "Ben");
    const email = `dn.clash.${id().slice(0, 8)}@example.com`;
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await toNameStep(page, token, email);
      for (const attempt of ["Ben B.", "  BEN   b.  "]) {
        await page.getByLabel("Display name").fill(attempt);
        await agreeToTerms(page);
        await page.getByRole("button", { name: "Continue" }).click();
        await expect(page.locator("main").getByRole("alert")).toHaveText(
          `Someone in Clash Club already goes by ${attempt.trim().replace(/\s+/g, " ")} Pick another.`,
        );
        await expect(page).toHaveURL(/nameTaken=1/);
        // The name never rides in the URL.
        expect(page.url()).not.toMatch(/ben/i);
        // Nothing created: no name, no membership, the invite still pending.
        const user = await userByEmail(email);
        expect(user.displayName).toBeNull();
        expect((await activeMemberships(c.clubId)).map((m) => m.userId).sort()).toEqual([ownerId, benId].sort());
        expect((await inviteRow(inviteId)).redeemedAt).toBeNull();
      }

      await page.getByLabel("Display name").fill("Benji");
      await agreeToTerms(page);
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page).toHaveURL(`/clubs/${c.clubId}/welcome`);
      expect((await userByEmail(email)).displayName).toBe("Benji");
      expect((await inviteRow(inviteId)).redeemedAt).not.toBeNull();
    } finally {
      await context.close();
    }
  });

  test("an account already named that clashes is asked for another name on the invite page, then joins", async ({ page }) => {
    const ownerId = await person("Ola O.", "dn-owner");
    const calId = await person("Cal C.", "dn-cal");
    const otherCal = await person("cal c.", "dn-cal2");
    const c = await club("Second Cal Club", ownerId, [calId]);
    const { token, inviteId } = await invite(c.clubId, c.ownerMembership, "Cal");

    // Signed in as the other Cal, joining as themself (Ruling B).
    await signInAsUser(page, otherCal);
    await page.goto(`/invite/${token}`);
    await page.getByRole("button", { name: /^Join Second Cal Club as/ }).click();
    await expect(page).toHaveURL(`/invite/${token}?nameTaken=1`);
    await expect(page.locator(".name-taken")).toHaveText("Someone in Second Cal Club already goes by cal c. Pick another.");
    expect((await inviteRow(inviteId)).redeemedAt).toBeNull();

    await page.getByLabel("Display name").fill("Callum");
    await page.getByRole("button", { name: "Join Second Cal Club" }).click();
    await expect(page).toHaveURL(new RegExp(`/clubs/${c.clubId}\\?joined=1`));
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, otherCal));
    expect(row.displayName).toBe("Callum");
  });

  test("a rename must be free in every club, naming the first that clashes; someone who left frees their name", async ({
    page,
  }) => {
    const meId = await person("Mo M.", "dn-mo");
    const ownerA = await person("Ann A.", "dn-ann");
    const ownerB = await person("Bea B.", "dn-bea");
    const deeId = await person("Dee D.", "dn-dee");
    const apple = await club("Apple Rename Club", ownerA, [meId, deeId]);
    await club("Birch Rename Club", ownerB, [meId]);

    await signInAsUser(page, meId);
    await page.goto("/settings");
    await expect(page.getByLabel("Display name")).toHaveValue("Mo M.");

    // Bea is in Birch only: Birch is named.
    await page.getByLabel("Display name").fill("BEA b.");
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(page).toHaveURL("/settings?nameTaken=1");
    await expect(page.locator("main").getByRole("alert")).toHaveText(
      "Someone in Birch Rename Club already goes by BEA b. Pick another.",
    );
    await expect(page.getByLabel("Display name")).toHaveValue("BEA b.");
    expect((await db.select().from(schema.users).where(eq(schema.users.id, meId)))[0].displayName).toBe("Mo M.");

    // Dee is in Apple: while she's there, it's taken.
    await page.getByLabel("Display name").fill("dee d.");
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(page.locator("main").getByRole("alert")).toHaveText(
      "Someone in Apple Rename Club already goes by dee d. Pick another.",
    );

    // Once Dee has left, the name is free again.
    await db
      .update(schema.memberships)
      .set({ leftAt: new Date() })
      .where(and(eq(schema.memberships.clubId, apple.clubId), eq(schema.memberships.userId, deeId)));
    await page.getByLabel("Display name").fill("Dee D.");
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(page).toHaveURL("/settings?saved=name");
    expect((await db.select().from(schema.users).where(eq(schema.users.id, meId)))[0].displayName).toBe("Dee D.");

    // Your own name is never a clash with yourself.
    await page.getByLabel("Display name").fill("DEE D.");
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(page).toHaveURL("/settings?saved=name");
  });

  test("the invite form asks only for their name, as a greeting", async ({ page }) => {
    const ownerId = await person("Ola O.", "dn-owner");
    const c = await club("Greeting Club", ownerId);
    await signInAsUser(page, ownerId);
    await page.goto(`/clubs/${c.clubId}/members/invite`);
    await expect(page.getByText("So the invite can greet them. They'll choose their own display name when they join.")).toBeVisible();
    await page.getByLabel("Their name").fill("Gran");
    await page.getByRole("button", { name: "Create invite link" }).click();
    await expect(page.getByLabel("Invite link for Gran")).toBeVisible();
    const link = await page.getByLabel("Invite link for Gran").inputValue();
    await page.context().clearCookies();
    await page.goto(link);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hi Gran");
  });
});
