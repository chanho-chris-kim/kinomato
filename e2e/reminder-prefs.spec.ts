import type { Browser, Page } from "@playwright/test";
import { neon } from "@neondatabase/serverless";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../db/schema";
import { anonymiseAccount } from "../app/anonymise";
import { clubDeletionStatements } from "../app/clubDeletion";
import { createUnsubscribeLink } from "../app/reminderUnsubscribe";
import { runRetentionCleanup } from "../app/retentionCleanup";
import { hashToken } from "../lib/authCredentials";
import { LEGAL } from "../lib/legal";
import { expect, test } from "./fixtures";
import { signInAsUser } from "./session";
import { expectNoneContain, recordRequestUrls } from "./signIn";

// Reminder preferences and unsubscribe links (docs/onboarding-spec.md §5.9,
// ruled 2026-11-23). No reminders are sent yet: links are made the way r3
// will make them, with createUnsubscribeLink and the Worker's own driver.

const db = drizzle(neon(process.env.E2E_DATABASE_URL!), { schema });
const id = () => crypto.randomUUID();
const at = new Date(Date.UTC(2026, 0, 1));
const DAY = 24 * 3600_000;

// Rae, in Alpha Club and Beta Club; Sol, in Alpha Club too.
async function people(tag: string) {
  const users = { rae: id(), sol: id() };
  const emails = { rae: `rae.${tag}@example.com`, sol: `sol.${tag}@example.com` };
  for (const key of ["rae", "sol"] as const) {
    await db.insert(schema.users).values({
      id: users[key],
      email: emails[key],
      displayName: key === "rae" ? "Rae P." : "Sol P.",
      ageBracket: "18_plus",
      ageAttestedAt: at,
    });
    await db.insert(schema.consentEvents).values(
      (["terms", "privacy"] as const).map((document) => ({
        userId: users[key],
        document,
        version: LEGAL[document].version,
        acceptedAt: at,
        method: "signup" as const,
      })),
    );
  }
  const clubs = { alpha: id(), beta: id() };
  for (const [key, name] of [["alpha", `Alpha ${tag}`], ["beta", `Beta ${tag}`]] as const) {
    await db.insert(schema.clubs).values({
      id: clubs[key],
      name,
      cadence: "weekly",
      defaultDay: 6,
      defaultTime: "20:00",
      timezone: "America/New_York",
      mode: "in_person",
    });
  }
  await db.insert(schema.memberships).values([
    { clubId: clubs.alpha, userId: users.rae, role: "owner" },
    { clubId: clubs.beta, userId: users.rae, role: "owner" },
    { clubId: clubs.alpha, userId: users.sol, role: "member" },
  ]);
  return { users, emails, clubs, names: { alpha: `Alpha ${tag}`, beta: `Beta ${tag}` } };
}

type People = Awaited<ReturnType<typeof people>>;

async function state(p: People) {
  const userRows = await db.select().from(schema.users);
  const memberRows = await db.select().from(schema.memberships);
  const mutedOf = (userId: string, clubId: string) =>
    memberRows.find((m) => m.userId === userId && m.clubId === clubId)?.remindersMutedAt !== null;
  return {
    raeReminders: userRows.find((u) => u.id === p.users.rae)!.emailReminders,
    solReminders: userRows.find((u) => u.id === p.users.sol)!.emailReminders,
    raeAlphaMuted: mutedOf(p.users.rae, p.clubs.alpha),
    raeBetaMuted: mutedOf(p.users.rae, p.clubs.beta),
    solAlphaMuted: mutedOf(p.users.sol, p.clubs.alpha),
  };
}
const untouched = { raeReminders: true, solReminders: true, raeAlphaMuted: false, raeBetaMuted: false, solAlphaMuted: false };

const origin = () => String(test.info().project.use.baseURL);
const tokenOf = (link: string) => link.split("/unsubscribe/")[1];

// Signed out, in its own browser context.
async function signedOut(browser: Browser, fn: (page: Page, requests: string[]) => Promise<void>) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  try {
    await fn(page, requests);
  } finally {
    await context.close();
  }
}

test.describe("reminder preferences in Settings", () => {
  test("the switch and per-club mutes persist; the export carries them", async ({ page }) => {
    const p = await people("settings");
    await signInAsUser(page, p.users.rae);
    await page.goto("/settings");
    const section = page.locator("#reminders");
    await expect(section.getByRole("heading", { name: "How we reach you" })).toBeVisible();
    await expect(section).toContainText("Sign-in codes and account notices always arrive.");
    await expect(section.locator(".reminder-emails-status")).toHaveText("Reminder emails: on");

    await section.getByRole("button", { name: "Turn off" }).click();
    await expect(section.locator(".reminder-emails-status")).toHaveText("Reminder emails: off");
    expect((await state(p)).raeReminders).toBe(false);
    await section.getByRole("button", { name: "Turn on" }).click();
    await expect(section.locator(".reminder-emails-status")).toHaveText("Reminder emails: on");

    await section.getByRole("button", { name: `Mute reminders from ${p.names.alpha}` }).click();
    await expect(section.getByRole("button", { name: `Unmute reminders from ${p.names.alpha}` })).toBeVisible();
    await page.reload();
    expect(await state(p)).toEqual({ ...untouched, raeAlphaMuted: true });

    const exported = await (await page.request.get("/settings/export")).json();
    expect(exported.account.reminder_emails).toBe(true);
    expect(
      exported.clubs.map((c: { name: string; reminders_muted_at: string | null }) => [c.name, c.reminders_muted_at !== null]).sort(),
    ).toEqual([
      [p.names.alpha, true],
      [p.names.beta, false],
    ]);

    await section.getByRole("button", { name: `Unmute reminders from ${p.names.alpha}` }).click();
    await expect(section.getByRole("button", { name: `Mute reminders from ${p.names.alpha}` })).toBeVisible();
    expect(await state(p)).toEqual(untouched);
  });
});

test.describe("the unsubscribe page", () => {
  test("opening it changes nothing; Mute only this club mutes exactly that; signed out; no ids in URLs; nothing third-party", async ({
    browser,
  }) => {
    const p = await people("mute");
    const link = await createUnsubscribeLink(db, p.users.rae, p.clubs.alpha, origin());
    expect(link).toMatch(/\/unsubscribe\/[A-Za-z0-9_-]{43}$/);
    // Only the hash is stored.
    const [row] = await db
      .select()
      .from(schema.reminderUnsubscribeTokens)
      .where(eq(schema.reminderUnsubscribeTokens.tokenHash, hashToken(tokenOf(link))));
    expect(row).toMatchObject({ userId: p.users.rae, clubId: p.clubs.alpha });

    await signedOut(browser, async (page, requests) => {
      const urls = recordRequestUrls(page);
      await page.goto(link);
      await expect(page.getByRole("heading", { name: "Reminder emails" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Stop all reminder emails" })).toBeVisible();
      const mute = page.getByRole("button", { name: `Mute only ${p.names.alpha}` });
      await expect(mute).toBeVisible();
      // A scanner's GET: nothing changed.
      expect(await state(p)).toEqual(untouched);

      await mute.click();
      await expect(page.locator(".unsubscribe-done")).toHaveText("Done. You can turn reminders back on in Settings.");
      expect(await state(p)).toEqual({ ...untouched, raeAlphaMuted: true });

      expectNoneContain(urls, p.emails.rae, "Rae", p.users.rae, p.clubs.alpha, p.names.alpha, "%40");
      const own = new URL(origin()).origin;
      expect(requests.filter((u) => !u.startsWith(own) && !u.startsWith("data:"))).toEqual([]);
    });
  });

  test("Stop all reminder emails turns only that person's reminders off", async ({ browser }) => {
    const p = await people("stop");
    const link = await createUnsubscribeLink(db, p.users.rae, p.clubs.alpha, origin());
    await signedOut(browser, async (page) => {
      await page.goto(link);
      expect(await state(p)).toEqual(untouched);
      await page.getByRole("button", { name: "Stop all reminder emails" }).click();
      await expect(page.locator(".unsubscribe-done")).toBeVisible();
    });
    // Rae's off; Sol, in the same club, untouched; no club muted.
    expect(await state(p)).toEqual({ ...untouched, raeReminders: false });
  });

  test("an expired or made-up link shows the expired message and changes nothing", async ({ browser }) => {
    const p = await people("expired");
    const old = await createUnsubscribeLink(db, p.users.rae, p.clubs.alpha, origin());
    await db
      .update(schema.reminderUnsubscribeTokens)
      .set({ createdAt: new Date(Date.now() - 91 * DAY) })
      .where(eq(schema.reminderUnsubscribeTokens.tokenHash, hashToken(tokenOf(old))));
    const madeUp = `${origin()}/unsubscribe/${"A".repeat(43)}`;
    const malformed = `${origin()}/unsubscribe/not-a-token`;

    await signedOut(browser, async (page) => {
      for (const link of [old, madeUp, malformed]) {
        await page.goto(link);
        await expect(page.locator(".unsubscribe-expired"), link).toHaveText(
          "This link has expired. You can change reminders in Settings.",
        );
        await expect(page.getByRole("button")).toHaveCount(0);
        await expect(page.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
      }

      // A page opened while the link worked, pressed after it stopped.
      const fresh = await createUnsubscribeLink(db, p.users.rae, p.clubs.alpha, origin());
      await page.goto(fresh);
      await db
        .update(schema.reminderUnsubscribeTokens)
        .set({ createdAt: new Date(Date.now() - 91 * DAY) })
        .where(eq(schema.reminderUnsubscribeTokens.tokenHash, hashToken(tokenOf(fresh))));
      await page.getByRole("button", { name: "Stop all reminder emails" }).click();
      await expect(page.locator(".unsubscribe-expired")).toBeVisible();
    });
    expect(await state(p)).toEqual(untouched);
  });

  test("muting a club you've left changes nothing", async ({ browser }) => {
    const p = await people("left");
    const link = await createUnsubscribeLink(db, p.users.rae, p.clubs.beta, origin());
    await db
      .update(schema.memberships)
      .set({ leftAt: new Date() })
      .where(and(eq(schema.memberships.userId, p.users.rae), eq(schema.memberships.clubId, p.clubs.beta)));
    await signedOut(browser, async (page) => {
      await page.goto(link);
      await page.getByRole("button", { name: `Mute only ${p.names.beta}` }).click();
      await expect(page.locator(".unsubscribe-done")).toBeVisible();
    });
    expect(await state(p)).toEqual(untouched);
  });
});

test.describe("unsubscribe links are removed with what they belong to", () => {
  const tokensOf = (userId: string) =>
    db.select().from(schema.reminderUnsubscribeTokens).where(eq(schema.reminderUnsubscribeTokens.userId, userId));

  test("by retention after 90 days, by account deletion, and by club deletion", async () => {
    const p = await people("cleanup");
    const oldLink = await createUnsubscribeLink(db, p.users.sol, p.clubs.alpha, origin());
    await createUnsubscribeLink(db, p.users.sol, p.clubs.alpha, origin());
    await db
      .update(schema.reminderUnsubscribeTokens)
      .set({ createdAt: new Date(Date.now() - 91 * DAY) })
      .where(eq(schema.reminderUnsubscribeTokens.tokenHash, hashToken(tokenOf(oldLink))));

    const original = console.log;
    console.log = () => {};
    try {
      const counts = await runRetentionCleanup(db, new Date());
      expect(counts.unsubscribe_links).toBeGreaterThanOrEqual(1);
    } finally {
      console.log = original;
    }
    expect(await tokensOf(p.users.sol)).toHaveLength(1);

    await anonymiseAccount(db, p.users.sol);
    expect(await tokensOf(p.users.sol)).toEqual([]);

    await createUnsubscribeLink(db, p.users.rae, p.clubs.beta, origin());
    await createUnsubscribeLink(db, p.users.rae, p.clubs.alpha, origin());
    const statements = clubDeletionStatements(db, [p.clubs.beta]);
    await db.batch(statements as [(typeof statements)[0], ...typeof statements]);
    expect((await tokensOf(p.users.rae)).map((t) => t.clubId)).toEqual([p.clubs.alpha]);
  });
});
