import type { Browser, Page } from "@playwright/test";
import { neon } from "@neondatabase/serverless";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../db/schema";
import { LEGAL } from "../lib/legal";
import { expect, test } from "./fixtures";
import { signInAsUser } from "./session";
import { expectNoneContain, recordRequestUrls } from "./signIn";

// The Settings redesign (u7, ruled 2026-11-27): a menu and the page beside
// it. Builds its own people and clubs; the actions are Settings' own.

const db = drizzle(neon(process.env.E2E_DATABASE_URL!), { schema });
const id = () => crypto.randomUUID();
const RUN = id().slice(0, 8);
const at = new Date(Date.UTC(2026, 0, 1));

async function person(displayName: string, ageBracket: "18_plus" | "13_17" = "18_plus") {
  const userId = id();
  const email = `sp.${displayName.toLowerCase().replace(/\W+/g, "")}.${RUN}.${userId.slice(0, 4)}@example.com`;
  await db.insert(schema.users).values({ id: userId, email, displayName, ageBracket, ageAttestedAt: at });
  await db.insert(schema.consentEvents).values(
    (["terms", "privacy"] as const).map((document) => ({
      userId,
      document,
      version: LEGAL[document].version,
      acceptedAt: at,
      method: "signup" as const,
    })),
  );
  return { id: userId, email, name: displayName };
}

// A person in two clubs.
async function member(displayName: string, ageBracket: "18_plus" | "13_17" = "18_plus") {
  const p = await person(displayName, ageBracket);
  const clubs = [`Alpha ${RUN}`, `Beta ${RUN}`];
  const ids: string[] = [];
  for (const name of clubs) {
    const clubId = id();
    ids.push(clubId);
    await db.insert(schema.clubs).values({ id: clubId, name, cadence: "ad_hoc", timezone: "America/New_York", mode: "in_person" });
    await db.insert(schema.memberships).values({ clubId, userId: p.id, role: "owner", joinedAt: at });
  }
  return { ...p, clubs, clubIds: ids };
}

const menuRow = (page: Page, title: string) => page.locator(".menu-row", { hasText: title });
const mainSwitch = (page: Page) => page.getByRole("switch", { name: /^Reminder emails/ });
const clubSwitch = (page: Page, club: string) => page.getByRole("switch", { name: `Reminders from ${club}` });
const muted = async (userId: string, clubId: string) =>
  (
    await db
      .select({ mutedAt: schema.memberships.remindersMutedAt })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.clubId, clubId)))
  )[0].mutedAt !== null;
const remindersOn = async (userId: string) =>
  (await db.select().from(schema.users).where(eq(schema.users.id, userId)))[0].emailReminders;

async function as(browser: Browser, userId: string, options: Parameters<Browser["newContext"]>[0] = {}) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await signInAsUser(page, userId);
  return { context, page };
}

test.describe("Settings (u7)", () => {
  test("the menu shows each page's current value: reminders and data sharing", async ({ page }) => {
    const me = await member("Rae");
    await signInAsUser(page, me.id);
    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
    await expect(page.locator(".profile-card")).toContainText(`Rae${me.email}`);
    await expect(menuRow(page, "Account")).toContainText("Display name, email");
    await expect(menuRow(page, "Reminders")).toContainText("RemindersOn");
    await expect(menuRow(page, "Privacy & data")).toContainText("Not sharing · download your data");

    await page.goto("/settings/reminders");
    await clubSwitch(page, me.clubs[0]).click();
    await expect(clubSwitch(page, me.clubs[0])).toHaveAttribute("aria-checked", "false");
    await expect(menuRow(page, "Reminders")).toContainText("On · 1 club muted");
    await mainSwitch(page).click();
    await expect(mainSwitch(page)).toHaveAttribute("aria-checked", "false");
    await expect(menuRow(page, "Reminders")).toContainText("RemindersOff");

    await page.goto("/settings/privacy");
    await page.getByRole("button", { name: "Opt in" }).click();
    await expect(page.getByRole("status")).toHaveText("You're sharing.");
    await expect(menuRow(page, "Privacy & data")).toContainText("Sharing · download your data");
  });

  test("the main switch turns every club off and disables their switches; both persist", async ({ page }) => {
    const me = await member("Sol");
    await signInAsUser(page, me.id);
    await page.goto("/settings/reminders");
    await expect(page.locator(".page-title")).toHaveText("Reminders");
    await expect(page.getByText("At most two a week across all your clubs, plus one when it's your turn to pick.")).toBeVisible();
    await expect(page.locator(".main-reminders")).toContainText("Your turn, voting closing, movie night, did you watch it");
    await expect(page.getByText("Sign-in codes and account notices always arrive.")).toBeVisible();

    // Beta muted first: it says so.
    await clubSwitch(page, me.clubs[1]).click();
    await expect(page.locator(".club-reminder-name", { hasText: me.clubs[1] })).toHaveText(`${me.clubs[1]} · muted`);
    expect(await muted(me.id, me.clubIds[1])).toBe(true);

    await mainSwitch(page).click();
    await expect(mainSwitch(page)).toHaveAttribute("aria-checked", "false");
    expect(await remindersOn(me.id)).toBe(false);
    for (const club of me.clubs) {
      await expect(clubSwitch(page, club)).toBeDisabled();
    }
    await expect(page.getByText("Turned off for all clubs")).toHaveCount(2);
    // A club's own setting is kept underneath.
    await page.reload();
    await expect(clubSwitch(page, me.clubs[0])).toHaveAttribute("aria-checked", "true");
    await expect(clubSwitch(page, me.clubs[1])).toHaveAttribute("aria-checked", "false");

    await mainSwitch(page).click();
    await expect(clubSwitch(page, me.clubs[0])).toBeEnabled();
    expect([await remindersOn(me.id), await muted(me.id, me.clubIds[0]), await muted(me.id, me.clubIds[1])]).toEqual([
      true,
      false,
      true,
    ]);
  });

  test("without script the switches still submit", async ({ browser }) => {
    const me = await member("Ned");
    const { context, page } = await as(browser, me.id, { javaScriptEnabled: false });
    await page.goto("/settings/reminders");
    await clubSwitch(page, me.clubs[0]).click();
    await expect(clubSwitch(page, me.clubs[0])).toHaveAttribute("aria-checked", "false");
    await mainSwitch(page).click();
    await expect(mainSwitch(page)).toHaveAttribute("aria-checked", "false");
    expect([await remindersOn(me.id), await muted(me.id, me.clubIds[0])]).toEqual([false, true]);
    await context.close();
  });

  test("a laptop: the menu on the left, the page beside it; a phone: one or the other", async ({ browser }) => {
    const me = await member("Lu");
    const { context, page } = await as(browser, me.id);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/settings");
    // /settings shows Account beside the menu.
    const menu = await page.locator(".settings-menu").boundingBox();
    const right = await page.locator(".settings-page").boundingBox();
    expect(right!.x).toBeGreaterThan(menu!.x + menu!.width - 1);
    await expect(page.getByLabel("Display name")).toBeVisible();
    await expect(menuRow(page, "Account")).toHaveAttribute("aria-current", "page");
    await page.goto("/settings/reminders");
    await expect(page.locator(".settings-menu")).toBeVisible();
    await expect(menuRow(page, "Reminders")).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "Settings", exact: true }).filter({ hasText: "←" })).toBeHidden();

    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/settings");
    await expect(page.locator(".settings-menu")).toBeVisible();
    await expect(page.getByLabel("Display name")).toBeHidden();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Delete my account…" })).toBeVisible();
    await menuRow(page, "Reminders").click();
    await expect(page).toHaveURL("/settings/reminders");
    await expect(page.locator(".settings-menu")).toBeHidden();
    await page.locator(".settings-back").getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL("/settings");
    await context.close();
  });

  test("each page's actions still work: name, privacy download, sign out everywhere", async ({ browser, page }) => {
    const me = await member("Max");
    const urls = recordRequestUrls(page);
    await signInAsUser(page, me.id);
    await page.goto("/settings");
    await menuRow(page, "Account").click();
    await expect(page).toHaveURL("/settings/account");
    await expect(page.locator(".page-title")).toHaveText("Account");
    await page.getByLabel("Display name").fill(`Maxine ${RUN}`);
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(page).toHaveURL("/settings/account?saved=name");
    await expect(page.locator(".profile-name")).toHaveText(`Maxine ${RUN}`);
    expectNoneContain(urls, `Maxine ${RUN}`, me.email);

    await page.goto("/settings/privacy");
    await expect(page.locator(".licensing-wording")).toHaveText(LEGAL.licensing.text);
    await expect(page.getByRole("link", { name: "Download my data" })).toHaveAttribute("href", "/settings/export");

    // Another browser signed in as the same person is signed out too.
    const other = await as(browser, me.id);
    await page.goto("/settings");
    await page.getByRole("link", { name: /Sign out everywhere/ }).click();
    await expect(page).toHaveURL("/settings/sign-out");
    await expect(page.getByText("Signs out every device and browser you're signed in on, this one included.")).toBeVisible();
    await page.getByRole("button", { name: "Sign out everywhere" }).click();
    await expect(page).toHaveURL("/");
    await other.page.goto("/settings");
    await expect(other.page).toHaveURL(/\/login\?returnTo=/);
    await other.context.close();
  });

  test("13–17: no data sharing, only the download", async ({ page }) => {
    const teen = await member("Tia", "13_17");
    await signInAsUser(page, teen.id);
    await page.goto("/settings/privacy");
    await expect(page.getByRole("heading", { name: "Data sharing" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Opt in" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Download my data" })).toBeVisible();
    await expect(menuRow(page, "Privacy & data")).toContainText("Download your data");
  });

  test("the delete flow starts from the menu, in the danger colour, and works as before", async ({ page }) => {
    const me = await member("Dee");
    await signInAsUser(page, me.id);
    await page.goto("/settings");
    const link = page.getByRole("link", { name: "Delete my account…" });
    const danger = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--danger)";
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    await expect(link).toHaveCSS("color", danger);
    await link.click();
    await expect(page).toHaveURL("/settings/delete-account");
    await expect(page.locator(".deletion-plan li")).toHaveCount(2);
    await page.getByRole("button", { name: "Send me a code" }).click();
    await expect(page.getByLabel("Code")).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete my account" })).toHaveClass(/danger/);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page).toHaveURL("/settings");
  });

  test("old links into the single page land on the new pages", async ({ page }) => {
    const me = await member("Oz");
    await signInAsUser(page, me.id);
    for (const [hash, path] of [
      ["#reminders", "/settings/reminders"],
      ["#data-sharing", "/settings/privacy"],
      ["#your-data", "/settings/privacy"],
      ["#signing-out", "/settings/sign-out"],
      ["#delete-account", "/settings/delete-account"],
      ["#your-email", "/settings/account"],
    ]) {
      await page.goto(`/settings${hash}`);
      await expect(page, hash).toHaveURL(path);
    }
  });

  test("44px targets and a focus ring on the menu and the switches", async ({ page }) => {
    const me = await member("Fay");
    await signInAsUser(page, me.id);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/settings");
    for (const row of await page.locator(".menu-row").all()) {
      expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await page.locator(".menu-row").first().focus();
    await expect(page.locator(".menu-row").first()).toHaveCSS("outline-style", "solid");
    await page.goto("/settings/reminders");
    for (const s of await page.getByRole("switch").all()) {
      expect((await s.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await mainSwitch(page).focus();
    await expect(mainSwitch(page)).toHaveCSS("outline-style", "solid");
  });
});
