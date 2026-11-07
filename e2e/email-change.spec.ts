import type { Browser, Page } from "@playwright/test";
import { and, count, eq, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import { expect, test } from "./fixtures";
import { sentTo } from "./outbox";
import { signInAs } from "./session";
import { finishCodeSignIn, nameYourself, setKnownEmailChangeCode } from "./signIn";

// Email change (docs/onboarding-spec.md §5.9 rulings; rebuild step 7b).
// Every account here is made fresh through the real code sign-in, so no
// seeded user's email moves. The emails "sent" are read from the test
// outbox (e2e/outbox.ts); nothing is really sent.
test.describe.configure({ mode: "serial" });

const SUPPORT = "support@kinomato.test";

async function withDb<T>(fn: (db: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>): Promise<T> {
  const client = postgres(process.env.E2E_DATABASE_URL!);
  try {
    return await fn(drizzle(client, { schema }));
  } finally {
    await client.end();
  }
}

const userByEmail = (email: string) =>
  withDb(async (db) => (await db.select().from(schema.users).where(eq(schema.users.email, email)))[0] ?? null);

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await finishCodeSignIn(page, email);
}

// A new account with a name and one club of its own.
async function signUpWithClub(page: Page, email: string, first: string, club: string) {
  await signIn(page, email);
  await nameYourself(page, first, "T");
  await expect(page).toHaveURL("/");
  await page.goto("/new");
  await page.getByLabel("Club name").fill(club);
  await page.getByLabel("Timezone").fill("America/New_York");
  await page.getByRole("button", { name: "Create club" }).click();
  await expect(page).toHaveURL(/\/clubs\/[0-9a-f-]{36}$/);
}

async function requestChange(page: Page, newEmail: string) {
  await page.goto("/settings");
  const field = page.locator('input[name="newEmail"]');
  await field.fill(newEmail);
  await field.locator("xpath=ancestor::form").getByRole("button").click();
}

async function enterCode(page: Page, code: string) {
  await page.locator(".email-pending").getByLabel("Code").fill(code);
  await page.getByRole("button", { name: "Confirm" }).click();
}

const pendingCard = (page: Page) => page.locator(".email-pending");
const alertText = (page: Page) => page.locator("main").getByRole("alert");

async function freshContext(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

// "/" signed in: a club card per club, or the empty state.
async function clubCardsOn(page: Page) {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  return page.locator("main a.clubcard").allTextContents();
}

test.describe("email change", () => {
  test("before the code: the old address still signs in, and the new one doesn't reach this account", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const old = "ec-ann@example.com";
    const next = "ec-ann-new@example.com";
    await signUpWithClub(page, old, "Ann", "Ann's Club");

    await requestChange(page, next);
    await expect(page).toHaveURL("/settings?email=sent");
    await expect(pendingCard(page)).toContainText("Code sent to e•••@example.com.");
    await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(page.locator(".current-email")).toHaveText(old);
    const codeMail = sentTo(next).filter((m) => m.kind === "email-change-code");
    expect(codeMail).toHaveLength(1);
    expect(codeMail[0].subject).toMatch(/^\d{6} /);
    expect(sentTo(old).filter((m) => m.kind !== "sign-in")).toEqual([]);

    // The new address shares sign-in's per-address limit: the change code
    // was just sent there, so a sign-in code has to wait.
    const b = await freshContext(browser);
    await b.page.goto("/login");
    await b.page.getByLabel("Email").fill(next);
    await b.page.getByRole("button", { name: "Send code" }).click();
    await expect(b.page.getByText("We just sent one.")).toBeVisible();
    // Past every 30-second cooldown (the change code there, and the
    // sign-up code to the old address).
    await page.waitForTimeout(31_000);

    // The old address still signs in, to this account and its club.
    const a = await freshContext(browser);
    await signIn(a.page, old);
    await expect(a.page).toHaveURL("/");
    expect(await clubCardsOn(a.page)).toEqual([expect.stringContaining("Ann's Club")]);
    await a.context.close();

    // The new address makes a new, separate account: it doesn't reach Ann's.
    await signIn(b.page, next);
    await nameYourself(b.page, "Other", "P");
    await expect(b.page).toHaveURL("/");
    await expect(b.page.getByText("You're not in a club yet.")).toBeVisible();
    await b.context.close();

    // That address is now someone else's: the change can't complete, and
    // nothing changed.
    await enterCode(page, await setKnownEmailChangeCode(old));
    await expect(alertText(page)).toHaveText("That code didn't work. Ask for a new one.");
    expect((await userByEmail(old))?.displayName).toBe("Ann T.");
    expect((await userByEmail(next))?.displayName).toBe("Other P.");
  });

  test("the code switches the address: same account, every other session ended, the old address told", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const old = "ec-ben@example.com";
    const next = "ec-ben-new@example.com";
    await signUpWithClub(page, old, "Ben", "Ben's Club");
    const ben = (await userByEmail(old))!;
    // A second browser signed in as Ben (a session row, like any other
    // device; a second code sign-in would sit in the per-address cooldown).
    const elsewhere = await freshContext(browser);
    const [membership] = await withDb((db) =>
      db.select({ id: schema.memberships.id }).from(schema.memberships).where(eq(schema.memberships.userId, ben.id)),
    );
    await signInAs(elsewhere.page, membership.id);
    const sessions = () =>
      withDb(async (db) => (await db.select({ n: count() }).from(schema.sessions).where(eq(schema.sessions.userId, ben.id)))[0].n);
    expect(await sessions()).toBe(2);

    await requestChange(page, next);
    await enterCode(page, await setKnownEmailChangeCode(old));
    await expect(page).toHaveURL("/settings?email=changed");
    await expect(page.locator("main").getByRole("status")).toContainText("Email changed.");
    await expect(page.locator(".current-email")).toHaveText(next);
    await expect(pendingCard(page)).toHaveCount(0);
    expect((await userByEmail(next))?.id).toBe(ben.id);

    // This browser stays signed in; every other session is gone.
    expect(await sessions()).toBe(1);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await elsewhere.page.goto("/settings");
    await expect(elsewhere.page).toHaveURL(/\/login\?returnTo=/);
    await elsewhere.context.close();

    // The new address signs in to the same account, club and all — once
    // past the 30-second per-address cooldown its change code started.
    await page.waitForTimeout(31_000);
    const n = await freshContext(browser);
    await signIn(n.page, next);
    await expect(n.page).toHaveURL("/");
    expect(await clubCardsOn(n.page)).toEqual([expect.stringContaining("Ben's Club")]);
    await n.context.close();

    // The old one no longer does: it's a brand-new, empty account.
    const o = await freshContext(browser);
    await signIn(o.page, old);
    await expect(o.page).toHaveURL(/\/welcome/);
    await o.context.close();

    // The old address was told, the new one masked, replies to support.
    const notices = sentTo(old).filter((m) => m.kind === "email-changed-notice");
    expect(notices).toHaveLength(1);
    expect(notices[0].replyTo).toBe(SUPPORT);
    expect(notices[0].html).toContain("Your Kinomato email was changed to e•••@example.com.");
    expect(notices[0].html).toContain("If this wasn't you, reply to this email.");
    expect(notices[0].html).not.toContain(next);
  });

  test("5 wrong codes lock it; Cancel ends it", async ({ page }) => {
    const me = "ec-cy@example.com";
    await signUpWithClub(page, me, "Cy", "Cy's Club");
    await requestChange(page, "ec-cy-new@example.com");
    await setKnownEmailChangeCode(me);
    for (let i = 1; i <= 4; i++) {
      await enterCode(page, "111111");
      await expect(alertText(page)).toHaveText("That code didn't work.");
    }
    await enterCode(page, "111111");
    await expect(alertText(page)).toHaveText("Too many wrong codes. Ask for a new one.");
    await expect(pendingCard(page)).toContainText("is locked after too many wrong tries");
    await expect(page.getByRole("button", { name: "Confirm" })).toHaveCount(0);
    expect((await userByEmail(me))?.email).toBe(me);

    await pendingCard(page).getByRole("button", { name: "Cancel" }).click();
    await expect(page).toHaveURL("/settings");
    await expect(pendingCard(page)).toHaveCount(0);
    await expect(page.getByText("New email address")).toBeVisible();
    const cancelled = await withDb((db) =>
      db
        .select({ n: count() })
        .from(schema.emailChanges)
        .where(and(eq(schema.emailChanges.newEmail, "ec-cy-new@example.com"), isNotNull(schema.emailChanges.cancelledAt))),
    );
    expect(cancelled[0].n).toBe(1);
  });

  test("a newer request cancels the older one", async ({ page }) => {
    const me = "ec-dee@example.com";
    await signUpWithClub(page, me, "Dee", "Dee's Club");
    await requestChange(page, "p-dee@example.com");
    await expect(pendingCard(page)).toContainText("Code sent to p•••@example.com.");
    await requestChange(page, "q-dee@example.com");
    await expect(pendingCard(page)).toContainText("Code sent to q•••@example.com.");

    const rows = await withDb((db) =>
      db.select().from(schema.emailChanges).where(eq(schema.emailChanges.newEmail, "p-dee@example.com")),
    );
    expect(rows[0].cancelledAt).not.toBeNull();
    // The older request's code no longer works, even if it's right.
    await enterCode(page, await setKnownEmailChangeCode(me, "p-dee@example.com"));
    await expect(alertText(page)).toHaveText("That code didn't work.");
    expect((await userByEmail(me))?.email).toBe(me);
  });

  test("an address that already has an account: the identical screen, a notice there, nothing changed", async ({
    page,
  }) => {
    const me = "ec-eve@example.com";
    // Kit's, a seeded account nothing else here emails (so it's outside the
    // shared per-address cooldown). Only the test outbox records the notice.
    const taken = "kit@example.com";
    await signUpWithClub(page, me, "Eve", "Eve's Club");
    const before = sentTo(taken).length;

    await requestChange(page, taken);
    // Exactly what a free address shows.
    await expect(page).toHaveURL("/settings?email=sent");
    await expect(pendingCard(page)).toContainText("Code sent to k•••@example.com.");
    await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(alertText(page)).toHaveCount(0);

    const newMail = sentTo(taken).slice(before);
    expect(newMail.map((m) => m.kind)).toEqual(["email-taken-notice"]);
    expect(newMail[0].html).toContain(
      "Someone tried to move a Kinomato account to this address. You already have one, so nothing changed.",
    );

    // Even with the code in hand, nothing moves.
    await enterCode(page, await setKnownEmailChangeCode(me));
    await expect(alertText(page)).toHaveText("That code didn't work. Ask for a new one.");
    expect((await userByEmail(me))?.email).toBe(me);
    expect((await userByEmail(taken))?.displayName).toBe("Kit K.");
  });

  test("a change code typed at /login/code does nothing", async ({ page, browser }) => {
    const me = "ec-fay@example.com";
    const next = "ec-fay-new@example.com";
    await signUpWithClub(page, me, "Fay", "Fay's Club");
    await requestChange(page, next);
    const code = await setKnownEmailChangeCode(me);

    const s = await freshContext(browser);
    await s.page.goto(`/login/code?${new URLSearchParams({ email: next })}`);
    await s.page.getByLabel("6-digit code").fill(code);
    await s.page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(s.page).toHaveURL(/\/login\/code\?.*error=expired/);
    await s.page.goto("/settings");
    await expect(s.page).toHaveURL(/\/login\?returnTo=/);
    await s.context.close();
    expect(await userByEmail(next)).toBeNull();
    expect((await userByEmail(me))?.email).toBe(me);
  });

  test("at most 3 change requests a day", async ({ page }) => {
    const me = "ec-gus@example.com";
    await signUpWithClub(page, me, "Gus", "Gus's Club");
    for (const to of ["a-gus@example.com", "b-gus@example.com", "c-gus@example.com"]) {
      await requestChange(page, to);
      await expect(page).toHaveURL("/settings?email=sent");
    }
    await requestChange(page, "d-gus@example.com");
    await expect(alertText(page)).toHaveText("You can ask to change your email 3 times a day. Try again tomorrow.");
    expect(sentTo("d-gus@example.com")).toEqual([]);
    const gus = (await userByEmail(me))!;
    const n = await withDb((db) =>
      db.select({ n: count() }).from(schema.emailChanges).where(eq(schema.emailChanges.userId, gus.id)),
    );
    expect(n[0].n).toBe(3);
  });
});
