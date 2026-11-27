import type { Page } from "@playwright/test";
import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../db/schema";
import { expect, test } from "./fixtures";
import { existingAccount, finishCodeSignIn, nameYourself, recordRequestUrls, expectNoneContain } from "./signIn";

// "Start a club" with sign-up open (u4, §5.13). Runs on CI's open-signup
// server (playwright.config.ts: this file's name ends open-signup.spec.ts).
// Its step bar, Email → Code → About you → Your club, shows for anyone who
// enters this way, account or not; an account already named skips About
// you. Plain sign-in never shows it.

const step = (page: Page) => page.locator('.signup-steps li[aria-current="step"] .weekbar-label');
const doneSteps = (page: Page) => page.locator(".signup-steps li.done .weekbar-label");

test.describe("Start a club (OPEN_SIGNUP=true)", () => {
  test("a new address walks the four steps to Your club, then the club's checklist", async ({ page }) => {
    const email = `start.new.${crypto.randomUUID().slice(0, 8)}@example.com`;
    const urls = recordRequestUrls(page);
    await page.goto("/");
    await page.locator("main").getByRole("link", { name: "Start a club" }).click();
    await expect(page).toHaveURL("/login/start");
    await expect(step(page)).toHaveText("Email");
    await expect(page.locator(".signup-steps li")).toHaveCount(4);

    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send my code" }).click();
    await expect(step(page)).toHaveText("Code");
    await finishCodeSignIn(page, email);
    await expect(page).toHaveURL(/\/welcome\?/);
    await expect(step(page)).toHaveText("About you");
    await nameYourself(page, "Una", "S");

    await expect(page).toHaveURL("/new?start=1");
    await expect(step(page)).toHaveText("Your club");
    // Done steps say so to screen readers too.
    await expect(doneSteps(page)).toHaveText(["Email (done)", "Code (done)", "About you (done)"]);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Start your club");
    await page.getByLabel("Club name").fill("Una's Club");
    await page.getByLabel("Timezone").fill("America/New_York");
    await page.getByRole("button", { name: "Create club" }).click();
    await expect(page).toHaveURL(/\/clubs\/[0-9a-f-]{36}$/);
    await expect(page.locator(".signup-steps")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Get Una's Club going" })).toBeVisible();
    expectNoneContain(urls, email, encodeURIComponent(email));
  });

  test("an account already named skips About you and lands on Your club", async ({ page }) => {
    const email = `start.named.${crypto.randomUUID().slice(0, 8)}@example.com`;
    // Named first, through plain sign-in.
    await existingAccount(email);
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send my code" }).click();
    await finishCodeSignIn(page, email);
    await nameYourself(page, "Nat", "S");
    await page.context().clearCookies();
    // Past the 30-second resend cooldown, so the next send isn't refused.
    await drizzle(neon(process.env.E2E_DATABASE_URL!), { schema })
      .update(schema.magicLinks)
      .set({ createdAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.magicLinks.email, email));

    await page.goto("/login/start");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send my code" }).click();
    // The code step looks the same as a new address's: no telling who has
    // an account.
    await expect(step(page)).toHaveText("Code");
    await finishCodeSignIn(page, email);
    await expect(page).toHaveURL("/new?start=1");
    await expect(step(page)).toHaveText("Your club");
    // Done steps say so to screen readers too.
    await expect(doneSteps(page)).toHaveText(["Email (done)", "Code (done)", "About you (done)"]);
  });

  test("Join a friend's club: \"Start your own\" shows with sign-up open; Your club links to /join", async ({ page }) => {
    const email = `start.join.${crypto.randomUUID().slice(0, 8)}@example.com`;
    await page.goto("/login/start");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send my code" }).click();
    await finishCodeSignIn(page, email);
    await nameYourself(page, "Jo", "S");
    await expect(page).toHaveURL("/new?start=1");
    await page.getByRole("link", { name: "Joining a friend's club instead?" }).click();
    await expect(page).toHaveURL("/join");
    await page.getByRole("link", { name: "Start your own" }).click();
    await expect(page).toHaveURL("/new");
  });

  test("plain sign-in never shows the bar", async ({ page }) => {
    const email = `start.plain.${crypto.randomUUID().slice(0, 8)}@example.com`;
    await existingAccount(email);
    await page.goto("/login");
    await expect(page.locator(".signup-steps")).toHaveCount(0);
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send my code" }).click();
    await expect(page).toHaveURL("/login/code");
    await expect(page.locator(".signup-steps")).toHaveCount(0);
  });
});
