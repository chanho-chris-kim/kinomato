import type { Browser, Page } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import {
  CONSENT_CLUB_ID,
  CONSENT_INVITE,
  CONSENT_NIGHT_ID,
  MEMBER_USER,
  MEMBERSHIP_CONSENT,
  MEMBERSHIP_RATING,
} from "../db/seed-fixtures";
import { LEGAL } from "../lib/legal";
import { collectConsoleErrors } from "./console-errors";
import { expect, test } from "./fixtures";
import { signInAs, signInAsUser } from "./session";
import { finishCodeSignIn } from "./signIn";

// Consent, data licensing and age (docs/onboarding-spec.md §11.1–§11.3;
// launch foundations (b)–(d)). New accounts give it all on /welcome; the
// seeded Gus and Fay (seed-fixtures.ts UNCONSENTED_USERS) are accounts from
// before consent existed and are sent to /consent. Every other seeded
// account already has current consent. Serial: Gus consents before
// Consent Club's history is read as him.
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

const userByEmail = (email: string) =>
  withDb(async (db) => (await db.select().from(schema.users).where(eq(schema.users.email, email)))[0] ?? null);
const userById = (id: string) =>
  withDb(async (db) => (await db.select().from(schema.users).where(eq(schema.users.id, id)))[0]);
const consentRows = (userId: string) =>
  withDb((db) => db.select().from(schema.consentEvents).where(eq(schema.consentEvents.userId, userId)));
const licensingRows = (userId: string) =>
  withDb((db) =>
    db.select().from(schema.dataLicensingConsents).where(eq(schema.dataLicensingConsents.userId, userId)),
  );

const termsBox = (page: Page) => page.getByLabel(/^I agree to the Terms/);
const licensingBox = (page: Page) => page.getByLabel(/^Optional\./);
const alert = (page: Page) => page.locator("main").getByRole("alert");

async function newAccountOnWelcome(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = collectConsoleErrors(page);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await finishCodeSignIn(page, email);
  await expect(page).toHaveURL(/\/welcome/);
  return { context, page, errors };
}

test.describe("consent", () => {
  test("a new account passes /welcome, Terms box required, before reaching /", async ({ browser }) => {
    const email = "newcomer.consent@example.com";
    const { context, page, errors } = await newAccountOnWelcome(browser, email);
    try {
      // Nothing signed-in is reachable first.
      await page.goto("/watchlist");
      await expect(page).toHaveURL(`/welcome?${new URLSearchParams({ next: "/watchlist" })}`);
      await page.goto("/");
      await expect(page).toHaveURL(`/welcome?${new URLSearchParams({ next: "/" })}`);

      await expect(termsBox(page)).not.toBeChecked();
      const form = page.locator("form.consent-form");
      await expect(form.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
      await expect(form.getByRole("link", { name: "Privacy policy" })).toHaveAttribute("href", "/privacy");
      await expect(page.getByText(`(version ${LEGAL.terms.version})`)).toBeVisible();
      // The data-sharing box: not there until "18 or older", unchecked then,
      // and gone again for 13–17.
      await expect(licensingBox(page)).toBeHidden();
      await page.getByLabel("18 or older").check();
      await expect(licensingBox(page)).toBeVisible();
      await expect(licensingBox(page)).not.toBeChecked();
      await page.getByLabel("13–17").check();
      await expect(licensingBox(page)).toBeHidden();
      await page.getByLabel("18 or older").check();

      await page.getByLabel("First name").fill("Nell");
      await page.getByLabel("Last initial").fill("c");
      // Required: without it, the server sends the form back.
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(alert(page)).toHaveText("To use Kinomato, agree to the Terms and the Privacy policy.");
      await expect(page.getByLabel("First name")).toHaveValue("Nell");
      await expect(page.getByLabel("18 or older")).toBeChecked();
      const before = (await userByEmail(email))!;
      expect([before.displayName, before.ageBracket]).toEqual([null, null]);
      expect(await consentRows(before.id)).toEqual([]);

      await termsBox(page).check();
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page).toHaveURL("/");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hi, Nell");

      const user = (await userByEmail(email))!;
      expect([user.displayName, user.ageBracket]).toEqual(["Nell C.", "18_plus"]);
      expect(user.ageAttestedAt).not.toBeNull();
      const rows = await consentRows(user.id);
      expect(rows.map((r) => [r.document, r.version, r.method]).sort()).toEqual([
        ["privacy", LEGAL.privacy.version, "signup"],
        ["terms", LEGAL.terms.version, "signup"],
      ]);
      // Left unchecked: no opt-in.
      expect(await licensingRows(user.id)).toEqual([]);

      // Through, and not asked again.
      await page.goto("/consent");
      await expect(page).toHaveURL("/");
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("13–17 gets no data-sharing box, and a forged opt-in is dropped", async ({ browser }) => {
    const email = "teen.consent@example.com";
    const { context, page, errors } = await newAccountOnWelcome(browser, email);
    try {
      await page.getByLabel("First name").fill("Tam");
      await page.getByLabel("Last initial").fill("D");
      await page.getByLabel("13–17").check();
      await expect(licensingBox(page)).toBeHidden();
      await termsBox(page).check();
      // The hidden box ticked anyway, as a hand-made request would send it.
      await page.locator('input[name="licensing"]').evaluate((el) => ((el as HTMLInputElement).checked = true));
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page).toHaveURL("/");

      const user = (await userByEmail(email))!;
      expect(user.ageBracket).toBe("13_17");
      expect(await licensingRows(user.id)).toEqual([]);

      // And no Data sharing in Settings.
      await page.goto("/settings");
      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Data sharing" })).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("an existing account is sent to /consent once; legal pages, sign-in and invites stay open", async ({ page }) => {
    await signInAs(page, MEMBERSHIP_CONSENT.gus);
    await page.goto("/watchlist");
    await expect(page).toHaveURL(`/consent?${new URLSearchParams({ next: "/watchlist" })}`);
    // Club pages and their server actions too.
    await page.goto(`/clubs/${CONSENT_CLUB_ID}/history`);
    await expect(page).toHaveURL(/\/consent\?next=/);

    // Reachable while pending.
    await page.goto("/terms");
    await expect(page.getByRole("heading", { level: 1, name: "Terms" })).toBeVisible();
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await page.goto(`/invite/${CONSENT_INVITE.token}`);
    await expect(page).toHaveURL(`/invite/${CONSENT_INVITE.token}`);

    await page.goto("/");
    await expect(page).toHaveURL(`/consent?${new URLSearchParams({ next: "/" })}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Agree to the current terms");
    await expect(licensingBox(page)).toBeHidden();
    await page.getByLabel("18 or older").check();
    await termsBox(page).check();
    await licensingBox(page).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hi, Gus");

    // First-ever acceptance: signup, not reconsent.
    const rows = await consentRows(MEMBER_USER.gus);
    expect(rows.map((r) => [r.document, r.version, r.method]).sort()).toEqual([
      ["privacy", LEGAL.privacy.version, "signup"],
      ["terms", LEGAL.terms.version, "signup"],
    ]);
    expect((await userById(MEMBER_USER.gus)).ageBracket).toBe("18_plus");
    const licensing = await licensingRows(MEMBER_USER.gus);
    expect(licensing.map((r) => [r.wordingVersion, r.withdrawnAt])).toEqual([[LEGAL.licensing.version, null]]);

    // Once only.
    await page.goto("/watchlist");
    await expect(page).toHaveURL("/watchlist");
    await page.goto("/consent");
    await expect(page).toHaveURL("/");
  });

  test("Sign out on /consent works with consent pending", async ({ page }) => {
    await signInAs(page, MEMBERSHIP_CONSENT.fay);
    await page.goto("/");
    await expect(page).toHaveURL(/\/consent/);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { level: 1, name: "Whose turn is it?" })).toBeVisible();
  });

  test("Under 13 on /consent anonymises the account per §11.4", async ({ page }) => {
    const fay = await userById(MEMBER_USER.fay);
    // A sign-in code and an email change on file, to see them go.
    await withDb(async (db) => {
      await db.insert(schema.magicLinks).values({
        email: fay.email,
        tokenHash: `unused-${crypto.randomUUID()}`,
        codeHash: "unused",
        expiresAt: new Date(Date.now() + 600_000),
      });
      await db.insert(schema.emailChanges).values({
        userId: fay.id,
        newEmail: "fay.new@example.com",
        codeHash: "unused",
        expiresAt: new Date(Date.now() + 600_000),
      });
    });
    await signInAs(page, MEMBERSHIP_CONSENT.fay);
    await page.goto("/");
    await page.getByLabel("Under 13").check();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL("/age-limit");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kinomato is for people 13 and up.");
    // Signed out.
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Whose turn is it?" })).toBeVisible();

    const after = await withDb(async (db) => {
      const m = MEMBERSHIP_CONSENT.fay;
      const [user] = await db.select().from(schema.users).where(eq(schema.users.id, fay.id));
      const [membership] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, m));
      const [rating] = await db
        .select()
        .from(schema.ratings)
        .where(and(eq(schema.ratings.nightId, CONSENT_NIGHT_ID), eq(schema.ratings.membershipId, m)));
      const [invite] = await db.select().from(schema.invites).where(eq(schema.invites.id, CONSENT_INVITE.id));
      const [night] = await db.select().from(schema.nights).where(eq(schema.nights.id, CONSENT_NIGHT_ID));
      return {
        user,
        membership,
        rating,
        invite,
        night,
        ratingTags: await db.select().from(schema.ratingTags).where(eq(schema.ratingTags.ratingId, rating.id)),
        watchlist: await db.select().from(schema.watchlistItems).where(eq(schema.watchlistItems.userId, fay.id)),
        constraints: await db.select().from(schema.constraints).where(eq(schema.constraints.membershipId, m)),
        sessions: await db.select().from(schema.sessions).where(eq(schema.sessions.userId, fay.id)),
        magicLinks: await db.select().from(schema.magicLinks).where(eq(schema.magicLinks.email, fay.email)),
        emailChanges: await db.select().from(schema.emailChanges).where(eq(schema.emailChanges.userId, fay.id)),
        nominations: await db.select().from(schema.nominations).where(eq(schema.nominations.membershipId, m)),
        votes: await db.select().from(schema.votes).where(eq(schema.votes.membershipId, m)),
      };
    });
    // Name and email.
    expect(after.user.displayName).toBe("Former member");
    expect(after.user.email).toBe(`deleted-${fay.id}@deleted.kinomato.invalid`);
    // Never a stored "under 13".
    expect(after.user.ageBracket).toBeNull();
    // Watchlist, limits and preferences: deleted.
    expect(after.watchlist).toEqual([]);
    expect(after.constraints).toEqual([]);
    // Ratings: scores kept, hot take and tags removed.
    expect([after.rating.scoreQuality, after.rating.scoreFun, after.rating.hotTake]).toEqual(["8.0", "7.5", null]);
    expect(after.ratingTags).toEqual([]);
    // Her pending invite: revoked, the name cleared.
    expect(after.invite.revokedAt).not.toBeNull();
    expect(after.invite.inviteeName).toBe("");
    // Membership: marked left, kept.
    expect(after.membership.leftAt).not.toBeNull();
    // Sessions, sign-in codes, email changes: deleted.
    expect([after.sessions, after.magicLinks, after.emailChanges]).toEqual([[], [], []]);
    // Votes, nominations and her pick: kept.
    expect(after.nominations).toHaveLength(1);
    expect(after.votes).toHaveLength(1);
    expect(after.night.pickerMembershipId).toBe(MEMBERSHIP_CONSENT.fay);

    // The address is released: a fresh sign-up with it is possible.
    expect(await userByEmail("fay@example.com")).toBeNull();

    // In the club's History, her pick reads "Former member".
    await signInAs(page, MEMBERSHIP_CONSENT.gus);
    await page.goto(`/clubs/${CONSENT_CLUB_ID}/history`);
    await expect(page.locator("main")).toContainText("Former member's pick");
    await expect(page.locator("main")).not.toContainText("Fay S.");
    await expect(page.locator("main")).not.toContainText("Fay's take");
  });

  test("Under 13 on /welcome leaves no account behind and puts the invite back", async ({ browser, page }) => {
    // A club whose owner has already picked, so the invitee is next in the
    // rotation and the owner's Tonight drafts a night for them.
    const ownerId = crypto.randomUUID();
    const clubId = crypto.randomUUID();
    const ownerMembershipId = crypto.randomUUID();
    const inviteId = crypto.randomUUID();
    const token = `under13-${crypto.randomUUID()}`;
    await withDb(async (db) => {
      const at = new Date(Date.UTC(2026, 0, 1));
      await db.insert(schema.users).values({
        id: ownerId,
        email: "ola.under13@example.com",
        displayName: "Ola K.",
        ageBracket: "18_plus",
        ageAttestedAt: at,
      });
      await db.insert(schema.consentEvents).values(
        (["terms", "privacy"] as const).map((document) => ({
          userId: ownerId,
          document,
          version: LEGAL[document].version,
          acceptedAt: at,
          method: "signup" as const,
        })),
      );
      await db.insert(schema.clubs).values({
        id: clubId,
        name: "Under Club",
        cadence: "weekly",
        defaultDay: 6,
        defaultTime: "20:00",
        timezone: "America/New_York",
        mode: "in_person",
      });
      await db.insert(schema.memberships).values({ id: ownerMembershipId, clubId, userId: ownerId, role: "owner", joinedAt: at });
      await db.insert(schema.nights).values({
        clubId,
        scheduledAt: new Date(Date.now() - 5 * 86_400_000),
        pickerMembershipId: ownerMembershipId,
        state: "watched",
        confirmedAt: new Date(Date.now() - 4 * 86_400_000),
        confirmedBy: ownerMembershipId,
      });
      await db.insert(schema.invites).values({
        id: inviteId,
        clubId,
        token,
        inviteeName: "Ned P.",
        invitedByMembershipId: ownerMembershipId,
      });
    });

    const email = "ned.under13@example.com";
    const context = await browser.newContext();
    const kid = await context.newPage();
    const errors = collectConsoleErrors(kid);
    try {
      await kid.goto(`/invite/${token}`);
      await kid.getByLabel("Your email").fill(email);
      await kid.getByRole("button", { name: "Continue" }).click();
      await finishCodeSignIn(kid, email);
      await expect(kid).toHaveURL(/\/welcome/);

      // The invite is redeemed and the membership exists at this point, and
      // the owner's Tonight drafts the next night for the newcomer.
      const ned = (await userByEmail(email))!;
      const [membership] = await withDb((db) =>
        db.select().from(schema.memberships).where(eq(schema.memberships.userId, ned.id)),
      );
      expect(membership.clubId).toBe(clubId);
      await signInAsUser(page, ownerId);
      await page.goto(`/clubs/${clubId}`);
      const drafts = () =>
        withDb((db) =>
          db
            .select()
            .from(schema.nights)
            .where(and(eq(schema.nights.clubId, clubId), inArray(schema.nights.state, ["draft"]))),
        );
      expect((await drafts()).map((n) => n.pickerMembershipId)).toEqual([membership.id]);

      await kid.getByLabel("Under 13").check();
      await kid.getByRole("button", { name: "Continue" }).click();
      await expect(kid).toHaveURL("/age-limit");
      await expect(kid.getByRole("heading", { level: 1 })).toHaveText("Kinomato is for people 13 and up.");

      // Nothing of theirs persists.
      const left = await withDb(async (db) => ({
        users: await db.select().from(schema.users).where(eq(schema.users.email, email)),
        sessions: await db.select().from(schema.sessions).where(eq(schema.sessions.userId, ned.id)),
        memberships: await db.select().from(schema.memberships).where(eq(schema.memberships.userId, ned.id)),
        magicLinks: await db.select().from(schema.magicLinks).where(eq(schema.magicLinks.email, email)),
        consent: await db.select().from(schema.consentEvents).where(eq(schema.consentEvents.userId, ned.id)),
        invite: (await db.select().from(schema.invites).where(eq(schema.invites.id, inviteId)))[0],
      }));
      expect([left.users, left.sessions, left.memberships, left.magicLinks, left.consent]).toEqual([[], [], [], [], []]);
      // The seat is free again and the link works for whoever it's for.
      expect([left.invite.redeemedAt, left.invite.redeemedByUserId, left.invite.revokedAt]).toEqual([null, null, null]);
      expect(await drafts()).toEqual([]);

      await kid.goto(`/invite/${token}`);
      await expect(kid.getByRole("heading", { level: 1 })).toHaveText("Hi Ned");
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("Settings' Data sharing: opt in and withdraw each write a row, and show the latest", async ({ page }) => {
    const rex = MEMBER_USER.rex;
    await signInAs(page, MEMBERSHIP_RATING.rex);
    await page.goto("/settings");
    const section = page.locator("section", { has: page.getByRole("heading", { name: "Data sharing" }) });
    await expect(section.locator(".data-sharing-status")).toHaveText("You're not sharing.");
    await expect(section).toContainText(LEGAL.licensing.text);

    await section.getByRole("button", { name: "Opt in" }).click();
    await expect(section.locator(".data-sharing-status")).toHaveText("You're sharing, in anonymous aggregates only.");
    await expect(section).toContainText("Withdrawing applies from now on");
    let rows = await licensingRows(rex);
    expect(rows.map((r) => [r.wordingVersion, r.withdrawnAt])).toEqual([[LEGAL.licensing.version, null]]);

    await section.getByRole("button", { name: "Withdraw" }).click();
    await expect(section.locator(".data-sharing-status")).toHaveText(
      "You're not sharing. You withdrew, so nothing new of yours goes into an aggregate.",
    );
    rows = await licensingRows(rex);
    // The same row, withdrawn: nothing deleted.
    expect(rows).toHaveLength(1);
    expect(rows[0].withdrawnAt).not.toBeNull();

    await section.getByRole("button", { name: "Opt in" }).click();
    await expect(section.locator(".data-sharing-status")).toHaveText("You're sharing, in anonymous aggregates only.");
    rows = await licensingRows(rex);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.withdrawnAt === null)).toHaveLength(1);
  });
});
