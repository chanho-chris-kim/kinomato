import type { Browser, Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import { LEGAL } from "../lib/legal";
import { maskEmail } from "../lib/emailAddress";
import { expect, test } from "./fixtures";
import { sentTo } from "./outbox";
import { agreeToTerms, existingAccount, finishCodeSignIn, latestSignInRow, nameYourself, setKnownSignIn } from "./signIn";

// Invite-only sign-up (docs/onboarding-spec.md §11.1, ruled 2026-11-18):
// until a lawyer has signed off the Terms and Privacy, only a personal
// invite creates an account. E2E's server runs with OPEN_SIGNUP unset, so
// closed (playwright.config.ts). The open path is e2e/open-signup.spec.ts.

type Db = ReturnType<typeof drizzle<typeof schema>>;
async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = postgres(process.env.E2E_DATABASE_URL!);
  try {
    return await fn(drizzle(client, { schema }));
  } finally {
    await client.end();
  }
}

const accountsWith = (email: string) => withDb((db) => db.select().from(schema.users).where(eq(schema.users.email, email)));
const INVITE_ONLY = "Kinomato is invite-only for now. Ask a member of a club to invite you.";

// Each in its own context: the console-error fixture covers `page` only.
async function asStranger(browser: Browser, fn: (page: Page) => Promise<void>) {
  const context = await browser.newContext();
  try {
    await fn(await context.newPage());
  } finally {
    await context.close();
  }
}

async function askForCode(page: Page, email: string, returnTo?: string) {
  await page.goto(returnTo ? `/login?${new URLSearchParams({ returnTo })}` : "/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send my code" }).click();
  await expect(page).toHaveURL(/\/login\/code/);
}

test.describe("invite-only sign-up", () => {
  test("the marketing page offers no sign-up while closed; Sign in stays", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("main").getByText("Invite-only for now", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Start a club" })).toHaveCount(0);
    await expect(page.locator("main").getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  test("an unknown address sees the normal code screen, gets the invite-only email, and no account is made, even with a forced code", async ({
    page,
  }) => {
    const email = "nobody.invited@example.com";
    await askForCode(page, email);
    // The same screen as an existing account's: no enumeration (§4.3).
    await expect(page.locator(".masked-email")).toHaveText(maskEmail(email));
    await expect(page.getByLabel("Your code")).toBeVisible();

    await expect.poll(() => sentTo(email).length).toBe(1);
    const mail = sentTo(email);
    expect(mail.map((m) => m.kind)).toEqual(["invite-only"]);
    expect(mail[0].html).toContain(INVITE_ONLY);
    expect(mail[0].subject + mail[0].html).not.toMatch(/\d{6}|\/verify/);
    expect(await accountsWith(email)).toEqual([]);

    // A guessed code gets the same countdown as anyone's.
    await page.getByLabel("Your code").fill("000000");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("That code didn't match. 4 tries left.")).toBeVisible();

    // Forcing a code onto the row still creates nothing.
    await finishCodeSignIn(page, email);
    await expect(page).toHaveURL(/\/login\?error=/);
    await expect(page.getByText(INVITE_ONLY)).toBeVisible();
    expect(await accountsWith(email)).toEqual([]);
    expect((await latestSignInRow(email))!.consumedAt).not.toBeNull();
    await page.goto("/watchlist");
    await expect(page).toHaveURL(/\/login\?returnTo=/);

  });

  test("a forced link, pressed for real, creates no account either", async ({ browser }) => {
    const email = "nobody.linked@example.com";
    await asStranger(browser, async (page) => {
      await askForCode(page, email);
      const { token } = await setKnownSignIn(email);
      await page.goto(`/verify?token=${token}`);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByText(INVITE_ONLY)).toBeVisible();
      await page.goto("/watchlist");
      await expect(page).toHaveURL(/\/login\?returnTo=/);
    });
    expect(await accountsWith(email)).toEqual([]);
    expect(sentTo(email).map((m) => m.kind)).toEqual(["invite-only"]);
  });

  test("the invite-only email counts against the same send limits", async ({ page }) => {
    const email = "nobody.twice@example.com";
    await askForCode(page, email);
    await askForCode(page, email);
    await expect(page).toHaveURL(/notice=wait/);
    expect(sentTo(email)).toHaveLength(1);
  });

  test("an invited new person still signs up end to end", async ({ browser }) => {
    const email = "invited.newcomer@example.com";
    const { clubId, token } = await withDb(async (db) => {
      const [owner] = await db
        .insert(schema.users)
        .values({ email: "gate.owner@example.com", displayName: "Gil O.", ageBracket: "18_plus", ageAttestedAt: new Date() })
        .returning();
      await db.insert(schema.consentEvents).values(
        (["terms", "privacy"] as const).map((document) => ({
          userId: owner.id,
          document,
          version: LEGAL[document].version,
          acceptedAt: new Date(),
          method: "signup" as const,
        })),
      );
      const [club] = await db
        .insert(schema.clubs)
        .values({ name: "Gate Club", cadence: "weekly", defaultDay: 6, defaultTime: "20:00", timezone: "America/New_York", mode: "in_person" })
        .returning();
      const [m] = await db.insert(schema.memberships).values({ clubId: club.id, userId: owner.id, role: "owner" }).returning();
      const token = `gate${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
      await db.insert(schema.invites).values({ clubId: club.id, token, inviteeName: "Nia N.", invitedByMembershipId: m.id });
      return { clubId: club.id, token };
    });

    await asStranger(browser, async (page) => {
      await page.goto(`/invite/${token}`);
      await page.getByLabel("Your email").fill(email);
      await page.getByRole("button", { name: "Send my code" }).click();
      await finishCodeSignIn(page, email);
      await expect(page).toHaveURL(/\/welcome/);
      await agreeToTerms(page);
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page).toHaveURL(`/clubs/${clubId}/welcome`);
    });
    expect(await accountsWith(email)).toHaveLength(1);
    expect(sentTo(email).map((m) => m.kind)).toEqual(["sign-in"]);
  });

  test("an existing account signs in as normal and can open /new", async ({ page }) => {
    const email = "already.here@example.com";
    await existingAccount(email);
    await askForCode(page, email, "/new");
    expect(sentTo(email).map((m) => m.kind)).toEqual(["sign-in"]);
    await finishCodeSignIn(page, email);
    await nameYourself(page, "Ari", "H");
    await expect(page).toHaveURL("/new");
    await expect(page.getByLabel("Club name")).toBeVisible();
  });
});
