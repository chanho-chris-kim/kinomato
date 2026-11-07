import type { Browser } from "@playwright/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import { MEMBER_USER, MEMBERSHIP_RATING } from "../db/seed-fixtures";
import { LEGAL } from "../lib/legal";
import { collectConsoleErrors } from "./console-errors";
import { expect, test } from "./fixtures";
import { signInAs } from "./session";
import { agreeToTerms, expectNoneContain, finishCodeSignIn, holdSignInAddress, recordRequestUrls } from "./signIn";

// No personal data in URLs (docs/onboarding-spec.md §11.6): Workers Logs
// keep every request URL. Each test records every URL the browser asks for
// (navigations, RSC fetches, server-action posts) and checks the address
// and any typed name appear in none. Must match app/signInCookie.ts.
const SIGN_IN_TIMED_OUT = "Your sign-in timed out. Enter your email to get a new code.";

async function withDb<T>(fn: (db: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>): Promise<T> {
  const client = postgres(process.env.E2E_DATABASE_URL!);
  try {
    return await fn(drizzle(client, { schema }));
  } finally {
    await client.end();
  }
}

async function freshPage(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page, errors: collectConsoleErrors(page), urls: recordRequestUrls(page) };
}

test.describe("no personal data in URLs", () => {
  test("sign-in by code, end to end, with a name mistake on /welcome", async ({ browser }) => {
    const email = "url.check@example.com";
    const { context, page, errors, urls } = await freshPage(browser);
    try {
      await page.goto(`/login?${new URLSearchParams({ returnTo: "/watchlist" })}`);
      await page.getByLabel("Email").fill(email);
      await page.getByRole("button", { name: "Send code" }).click();
      // returnTo stays: a path, not personal.
      await expect(page).toHaveURL(`/login/code?${new URLSearchParams({ returnTo: "/watchlist" })}`);
      await finishCodeSignIn(page, email);
      await expect(page).toHaveURL(/\/welcome/);

      // A mistake keeps what was typed, without putting it in the URL.
      await page.getByLabel("First name").fill("Ursula");
      await page.getByLabel("Last initial").fill("7");
      await agreeToTerms(page);
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.locator("main").getByRole("alert")).toHaveText("Last initial must be exactly one letter.");
      await expect(page.getByLabel("First name")).toHaveValue("Ursula");
      await expect(page.getByLabel("Last initial")).toHaveValue("7");
      await expect(page.getByLabel("18 or older")).toBeChecked();

      await page.getByLabel("Last initial").fill("v");
      await agreeToTerms(page);
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page).toHaveURL("/watchlist");

      // The sign-in cookie is gone once signed in.
      const cookies = await context.cookies();
      expect(cookies.map((c) => c.name)).not.toContain("kinomato_signin_email");
      expectNoneContain(urls, email, "url.check", "Ursula");
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("the invite flow puts neither the address nor the name in a URL", async ({ browser }) => {
    // A club of its own, so no seeded club's rotation changes.
    const ownerId = crypto.randomUUID();
    const clubId = crypto.randomUUID();
    const ownerMembershipId = crypto.randomUUID();
    const token = `no-pii-${crypto.randomUUID()}`;
    await withDb(async (db) => {
      const at = new Date(Date.UTC(2026, 0, 1));
      await db.insert(schema.users).values({
        id: ownerId,
        email: "url.owner@example.com",
        displayName: "Oona P.",
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
        name: "Url Club",
        cadence: "weekly",
        defaultDay: 6,
        defaultTime: "20:00",
        timezone: "America/New_York",
        mode: "in_person",
      });
      await db.insert(schema.memberships).values({ id: ownerMembershipId, clubId, userId: ownerId, role: "owner", joinedAt: at });
      await db.insert(schema.invites).values({ clubId, token, inviteeName: "Ivor Q.", invitedByMembershipId: ownerMembershipId });
    });

    const email = "url.invitee@example.com";
    const { context, page, errors, urls } = await freshPage(browser);
    try {
      await page.goto(`/invite/${token}`);
      await page.getByLabel("Your email").fill(email);
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page).toHaveURL("/login/code");
      await finishCodeSignIn(page, email);
      await expect(page).toHaveURL(/\/welcome/);
      await expect(page.getByLabel("First name")).toHaveValue("Ivor");
      await agreeToTerms(page);
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page).toHaveURL(`/clubs/${clubId}?joined=1`);
      expectNoneContain(urls, email, "url.invitee", "Ivor");
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("with no sign-in cookie, /login/code goes back to /login with a plain message", async ({ browser }) => {
    const { context, page, errors } = await freshPage(browser);
    try {
      // Never asked, or another browser, or the 15 minutes are up.
      await page.goto(`/login/code?${new URLSearchParams({ returnTo: "/watchlist" })}`);
      await expect(page).toHaveURL(`/login?${new URLSearchParams({ error: SIGN_IN_TIMED_OUT, returnTo: "/watchlist" })}`);
      await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
      await expect(page.getByText(SIGN_IN_TIMED_OUT)).toBeVisible();

      // The cookie expiring while the code screen is open: the submit lands
      // there too, not on an error page.
      await holdSignInAddress(page, "url.expired@example.com");
      await page.goto("/login/code");
      await expect(page.getByLabel("6-digit code")).toBeVisible();
      await context.clearCookies();
      await page.getByLabel("6-digit code").fill("123456");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(`/login?${new URLSearchParams({ error: SIGN_IN_TIMED_OUT })}`);
      await expect(page.getByText(SIGN_IN_TIMED_OUT)).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("a name mistake on /settings keeps what was typed, with no name in the URL", async ({ page }) => {
    const urls = recordRequestUrls(page);
    await signInAs(page, MEMBERSHIP_RATING.quin);
    await page.goto("/settings");
    await page.getByLabel("First name").fill("Quentin");
    await page.getByLabel("Last initial").fill("9");
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(page.locator("main").getByRole("alert")).toHaveText("Last initial must be exactly one letter.");
    await expect(page.getByLabel("First name")).toHaveValue("Quentin");
    await expect(page.getByLabel("Last initial")).toHaveValue("9");
    // Nothing saved.
    const [quin] = await withDb((db) => db.select().from(schema.users).where(eq(schema.users.id, MEMBER_USER.quin)));
    expect(quin.displayName).toBe("Quin M.");
    // Reloading later shows the saved name, not the stale echo.
    await page.goto("/settings");
    await expect(page.getByLabel("First name")).toHaveValue("Quin");
    expectNoneContain(urls, "Quentin");
  });
});
