import type { Page } from "@playwright/test";
import { neon } from "@neondatabase/serverless";
import { desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../db/schema";
import { SEND_COOLDOWN_SECONDS } from "../lib/authCredentials";
import { generateInviteToken } from "../lib/invites";
import { LEGAL } from "../lib/legal";
import { expect, test } from "./fixtures";
import { signInAsUser } from "./session";
import {
  agreeToTerms,
  existingAccount,
  expectNoneContain,
  finishCodeSignIn,
  recordRequestUrls,
  setKnownSignIn,
} from "./signIn";

// Invited sign-up and sign-in (u3, §5.13). The step bar (Email → Code →
// About you) only in an invited sign-up, never on a returning sign-in;
// one code field that takes a paste; Resend held back exactly as long as
// the server would refuse it; the data-sharing box with its full wording;
// the club welcome page; two columns for sign-in on a laptop.

const db = drizzle(neon(process.env.E2E_DATABASE_URL!), { schema });
const id = () => crypto.randomUUID();
const at = new Date(Date.UTC(2026, 0, 1));

async function person(displayName: string, tag: string) {
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

// A club with Ola as owner and Pia as a member, and an invite for "Max".
async function invitedClub(name: string) {
  const ola = await person("Ola O.", "sf-ola");
  const pia = await person("Pia P.", "sf-pia");
  const clubId = id();
  await db.insert(schema.clubs).values({ id: clubId, name, cadence: "ad_hoc", timezone: "America/New_York", mode: "in_person" });
  const olaMembership = id();
  await db.insert(schema.memberships).values([
    { id: olaMembership, clubId, userId: ola, role: "owner", joinedAt: at },
    { clubId, userId: pia, role: "member", joinedAt: new Date(at.getTime() + 86_400_000) },
  ]);
  const token = generateInviteToken();
  const [invite] = await db
    .insert(schema.invites)
    .values({ clubId, token, inviteeName: "Max", invitedByMembershipId: olaMembership })
    .returning();
  return { clubId, token, inviteId: invite.id, ola, pia };
}

const step = (page: Page) => page.locator('.signup-steps li[aria-current="step"] .weekbar-label');
const latestCode = async (email: string) =>
  (await db.select().from(schema.magicLinks).where(eq(schema.magicLinks.email, email)).orderBy(desc(schema.magicLinks.createdAt)).limit(1))[0];

test.describe("invited sign-up and sign-in", () => {
  test("the step bar walks an invited sign-up, Email → Code → About you, then stops; the invite stays in view", async ({
    browser,
  }) => {
    const c = await invitedClub("Bar Club");
    const email = `sf.bar.${id().slice(0, 8)}@example.com`;
    const context = await browser.newContext();
    const page = await context.newPage();
    const urls = recordRequestUrls(page);
    try {
      await page.goto(`/invite/${c.token}`);
      await expect(step(page)).toHaveText("Email");
      await expect(page.locator(".invite-card p")).toHaveText("Ola O. invited you to Bar Club");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hi Max");
      await expect(page.getByText("Let's get you into the club. It takes about a minute.")).toBeVisible();
      await expect(page.getByText("No password, ever. We email you a 6-digit code each time.")).toBeVisible();
      await expect(page.getByText("No trackers following you around. Ever.")).toBeVisible();
      await expect(page.getByText("Not Max? Ask Ola O. for your own link.")).toBeVisible();

      await page.getByLabel("Your email").fill(email);
      await page.getByRole("button", { name: "Send my code" }).click();
      await expect(page).toHaveURL("/login/code");
      await expect(step(page)).toHaveText("Code");
      await expect(page.locator(".signup-steps li.done")).toHaveCount(1);
      await expect(page.locator(".invite-card p")).toHaveText("Ola O. invited you to Bar Club");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check your email");

      await finishCodeSignIn(page, email);
      await expect(page).toHaveURL(/\/welcome\?/);
      await expect(step(page)).toHaveText("About you");
      await expect(page.locator(".invite-card p")).toHaveText("Ola O. invited you to Bar Club");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("What should the club call you?");
      await page.getByLabel("Display name").fill("Max M.");
      await agreeToTerms(page);
      await page.getByRole("button", { name: "Continue" }).click();

      // Done with sign-up: the club's welcome page has no bar.
      await expect(page).toHaveURL(`/clubs/${c.clubId}/welcome`);
      await expect(page.locator(".signup-steps")).toHaveCount(0);
      expectNoneContain(urls, email, encodeURIComponent(email), "Max%20M", "Max M.");
    } finally {
      await context.close();
    }
  });

  test("a returning sign-in has no bar and no invite card, and says where the code went", async ({ page }) => {
    const email = `sf.back.${id().slice(0, 8)}@example.com`;
    await existingAccount(email);
    await page.goto("/login");
    await expect(page.locator(".signup-steps")).toHaveCount(0);
    await expect(page.getByText("No password, ever. We'll email you a 6-digit code.")).toBeVisible();
    await expect(page.locator(".invite-only-note")).toHaveText(
      "New here? Kinomato is invite-only for now. Ask someone in a club to invite you.",
    );
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send my code" }).click();
    await expect(page).toHaveURL("/login/code");
    await expect(page.locator(".signup-steps")).toHaveCount(0);
    await expect(page.locator(".invite-card")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check your email");
    await expect(page.locator("main")).toContainText("Sent to");
    await expect(page.getByRole("link", { name: "Change" })).toHaveAttribute("href", "/login");
  });

  test("an invite opened by a named account shows no bar", async ({ page }) => {
    const c = await invitedClub("Named Club");
    const other = await person("Quinn Q.", "sf-quinn");
    await signInAsUser(page, other);
    await page.goto(`/invite/${c.token}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This invite is for Max");
    await expect(page.locator(".signup-steps")).toHaveCount(0);
  });

  test("the code is one field that takes a pasted 6-digit code and submits", async ({ page }) => {
    const email = `sf.paste.${id().slice(0, 8)}@example.com`;
    await existingAccount(email);
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send my code" }).click();
    const field = page.getByLabel("Your code");
    await expect(page.locator(".code-boxes input")).toHaveCount(1);
    await expect(field).toHaveAttribute("inputmode", "numeric");
    await expect(field).toHaveAttribute("autocomplete", "one-time-code");
    await expect(field).toHaveAttribute("maxlength", "6");
    await expect(field).toHaveAttribute("pattern", "\\d{6}");
    await expect(page.getByText("Tip: paste the whole code, or tap the link in the same email.")).toBeVisible();

    const { code } = await setKnownSignIn(email);
    await field.focus();
    // A paste, as the browser does it: the whole code inserted at once.
    await page.keyboard.insertText(code);
    await expect(field).toHaveValue(code);
    await page.keyboard.press("Enter");
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("Resend waits exactly as long as the server would refuse; an early send is still refused", async ({ page }) => {
    const email = `sf.resend.${id().slice(0, 8)}@example.com`;
    await existingAccount(email);
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send my code" }).click();
    await expect(page).toHaveURL("/login/code");
    await expect(page.getByText("Check spam or promotions. Codes last 15 minutes.")).toBeVisible();

    // The countdown matches the cooldown, measured from the send's own
    // timestamp in the database (never the test's clock).
    const resend = page.getByRole("button", { name: "Resend" });
    await expect(resend).toBeDisabled();
    const shown = Number((await page.locator(".resend-wait").textContent())!.match(/(\d+) seconds?/)![1]);
    const [{ elapsed }] = (await db.execute(
      sql`SELECT extract(epoch FROM now() - max(created_at))::float AS elapsed FROM magic_links WHERE email = ${email}`,
    )).rows as { elapsed: number }[];
    expect(Math.abs(shown - (SEND_COOLDOWN_SECONDS - elapsed))).toBeLessThanOrEqual(3);
    // With script, it ticks down.
    await expect
      .poll(async () => Number((await page.locator(".resend-wait").textContent())?.match(/(\d+)/)?.[1] ?? 0), { timeout: 4000 })
      .toBeLessThan(shown);

    // Forcing the button early changes nothing: the server still refuses.
    const before = await latestCode(email);
    await resend.evaluate((b) => ((b as HTMLButtonElement).disabled = false));
    await resend.click();
    await expect(page).toHaveURL("/login/code?notice=wait");
    expect((await latestCode(email)).id).toBe(before.id);

    // Once the cooldown has passed, it's offered.
    await db
      .update(schema.magicLinks)
      .set({ createdAt: new Date(Date.now() - (SEND_COOLDOWN_SECONDS + 5) * 1000) })
      .where(eq(schema.magicLinks.email, email));
    await page.goto("/login/code");
    await expect(page.getByRole("button", { name: "Resend" })).toBeEnabled();
    await expect(page.locator(".resend-wait")).toHaveCount(0);
  });

  test("without script, Resend says when it will be available", async ({ browser }) => {
    const email = `sf.nojs.${id().slice(0, 8)}@example.com`;
    await existingAccount(email);
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    try {
      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await page.getByRole("button", { name: "Send my code" }).click();
      await expect(page).toHaveURL("/login/code");
      await expect(page.getByRole("button", { name: "Resend" })).toBeDisabled();
      await expect(page.locator(".resend-wait")).toHaveText(/^Resend available in \d+ seconds?$/);
      // The code still goes in and submits without script.
      const { code } = await setKnownSignIn(email);
      await page.getByLabel("Your code").fill(code);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).not.toHaveURL(/\/login/);
    } finally {
      await context.close();
    }
  });

  test("a resend in an invited sign-up keeps the invite, so the new code still signs them up", async ({ browser }) => {
    const c = await invitedClub("Resend Club");
    const email = `sf.reinvite.${id().slice(0, 8)}@example.com`;
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`/invite/${c.token}`);
      await page.getByLabel("Your email").fill(email);
      await page.getByRole("button", { name: "Send my code" }).click();
      await expect(page).toHaveURL("/login/code");
      await db
        .update(schema.magicLinks)
        .set({ createdAt: new Date(Date.now() - (SEND_COOLDOWN_SECONDS + 5) * 1000) })
        .where(eq(schema.magicLinks.email, email));
      await page.goto("/login/code");
      await page.getByRole("button", { name: "Resend" }).click();
      await expect(page).toHaveURL("/login/code");
      const resent = await latestCode(email);
      expect(resent.inviteId).toBe(c.inviteId);
      await expect(step(page)).toHaveText("Code");

      await finishCodeSignIn(page, email);
      await expect(page).toHaveURL(/\/welcome\?/);
      await expect(step(page)).toHaveText("About you");
    } finally {
      await context.close();
    }
  });

  test("the data-sharing box: one line, the full wording under \"More about this\", unticked, only for 18 or older", async ({
    browser,
  }) => {
    const c = await invitedClub("Consent Club");
    const email = `sf.consent.${id().slice(0, 8)}@example.com`;
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`/invite/${c.token}`);
      await page.getByLabel("Your email").fill(email);
      await page.getByRole("button", { name: "Send my code" }).click();
      await finishCodeSignIn(page, email);
      await expect(page).toHaveURL(/\/welcome\?/);

      const box = page.getByLabel(/^Optional:/);
      await expect(box).toBeHidden();
      await page.getByLabel("13–17").check();
      await expect(box).toBeHidden();
      await page.getByLabel("18 or older").check();
      await expect(box).toBeVisible();
      await expect(box).not.toBeChecked();
      await expect(page.locator(".licensing-optin label")).toHaveText(
        "Optional: include my activity in anonymous film-industry trends. Never anything that identifies me.",
      );
      // The full current wording, unchanged, one tap away.
      const more = page.locator("details.licensing-more");
      await more.locator("summary").click();
      await expect(more.locator(".licensing-wording")).toHaveText(LEGAL.licensing.text);
      // Each age is a large target.
      for (const option of await page.locator(".age-option").all()) {
        expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(48);
      }
    } finally {
      await context.close();
    }
  });

  test("the club welcome page: a three-film counter, Add from what the club wants (counts only, no names), Skip", async ({
    page,
  }) => {
    const c = await invitedClub("Welcome Club");
    const me = await person("Nia N.", "sf-nia");
    await db.insert(schema.memberships).values({ clubId: c.clubId, userId: me, role: "member", joinedAt: new Date() });
    const titles = ["Arrival", "Thief", "Paddington 2", "The Thing"];
    const filmRows = await db.select().from(schema.films);
    const ids = titles.map((t) => filmRows.find((f) => f.title === t)!.id);
    // Pia wants all four; Ola wants Arrival too.
    await db.insert(schema.watchlistItems).values([
      ...ids.map((filmId) => ({ userId: c.pia, filmId })),
      { userId: c.ola, filmId: ids[0] },
    ]);

    await signInAsUser(page, me);
    await page.goto(`/clubs/${c.clubId}/welcome`);
    await expect(page.locator(".eyebrow").first()).toHaveText("Welcome to Welcome Club");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("You're in, Nia N.");
    await expect(page.locator(".goal-count")).toHaveText("0 of 3 added");
    const wanted = page.locator(".wanted-in-club");
    await expect(wanted.getByRole("heading")).toHaveText("Wanted in Welcome Club");
    await expect(wanted.locator("li", { hasText: "Arrival" })).toContainText("2 in the club want this");
    await expect(wanted.locator("li", { hasText: "Thief" })).toContainText("1 in the club wants this");
    // Counts only: nobody's name anywhere on the page.
    await expect(page.locator("main")).not.toContainText("Pia");
    await expect(page.locator("main")).not.toContainText("Ola");
    // Go to the club is outlined until three are added; Skip is there.
    await expect(page.getByRole("link", { name: "Go to Welcome Club" })).not.toHaveClass(/primary/);
    await expect(page.getByRole("link", { name: "Skip for now" })).toHaveAttribute("href", `/clubs/${c.clubId}`);

    for (const [i, title] of ["Arrival", "Thief", "Paddington 2"].entries()) {
      await wanted.getByRole("button", { name: `Add ${title} to my list` }).click();
      await expect(wanted.locator("li", { hasText: title })).toContainText("Added ✓");
      await expect(page.locator(".goal-count")).toHaveText(i < 2 ? `${i + 1} of 3 added` : "3 added · you're set");
    }
    await expect(page.getByRole("link", { name: "Go to Welcome Club" })).toHaveClass(/primary/);
    await page.getByRole("link", { name: "Go to Welcome Club" }).click();
    await expect(page).toHaveURL(`/clubs/${c.clubId}`);
  });

  test("sign-in is two columns on a laptop and one on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/login");
    const pitch = page.locator(".signin-pitch");
    const card = page.locator(".signin-card");
    await expect(pitch).toBeVisible();
    await expect(pitch).toContainText("Movie night, sorted.");
    await expect(pitch.locator("li")).toHaveCount(3);
    const [p, c] = [(await pitch.boundingBox())!, (await card.boundingBox())!];
    expect(p.x + p.width).toBeLessThanOrEqual(c.x);

    await page.setViewportSize({ width: 375, height: 800 });
    await expect(pitch).toBeHidden();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
  });
});
