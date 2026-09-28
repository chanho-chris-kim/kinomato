import type { Browser, Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import {
  CLUB_8_ID,
  CLUB_ID,
  DISPLAY_NAME_8,
  FULL_CLUB_INVITE,
  MEMBERSHIP,
  MEMBERSHIP_2,
  MEMBERSHIP_8,
} from "../db/seed-fixtures";
import { collectConsoleErrors } from "./console-errors";
import { expect, test } from "./fixtures";
import { signInAs } from "./session";
import { setKnownSignIn } from "./signIn";

// Per-person invites (docs/onboarding-spec.md §7, rebuild step 3), on club
// 8 (Hana owns it, Ivo is a member). Serial: later tests build on invites
// earlier ones created and redeemed.
test.describe.configure({ mode: "serial" });

const CLUB_8_URL = `/clubs/${CLUB_8_ID}`;
let marcoLink = "";

async function signInTo(page: Page, membershipId: string, url = CLUB_8_URL) {
  await signInAs(page, membershipId);
  await page.goto(url);
}

async function createInvite(page: Page, firstName: string, lastInitial: string) {
  await page.getByLabel("First name").fill(firstName);
  await page.getByLabel("Last initial").fill(lastInitial);
  await page.getByRole("button", { name: "Create invite" }).click();
  await expect(page).toHaveURL(/\?invite=/);
}

async function inviteLink(page: Page, inviteeName: string): Promise<string> {
  return page.getByLabel(`Invite link for ${inviteeName}`).inputValue();
}

// A signed-out visitor: its own browser context, no cookies at all.
async function asStranger<T>(browser: Browser, run: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = collectConsoleErrors(page);
  try {
    const result = await run(page);
    expect(errors).toEqual([]);
    return result;
  } finally {
    await context.close();
  }
}

async function inviteRow(token: string) {
  const client = postgres(process.env.E2E_DATABASE_URL!);
  try {
    const [row] = await drizzle(client, { schema })
      .select()
      .from(schema.invites)
      .where(eq(schema.invites.token, token));
    return row;
  } finally {
    await client.end();
  }
}

test.describe("per-person invites", () => {
  test("an owner creates an invite: pending, holding a seat, with its own link", async ({ page }) => {
    await signInTo(page, MEMBERSHIP_8.hana);
    await expect(page.getByText("2 of 6 seats.")).toBeVisible();

    await createInvite(page, "Marco", "r");
    await expect(page.getByText("3 of 6 seats.")).toBeVisible();
    await expect(page.getByText("Invite ready. Send it to Marco R. directly")).toBeVisible();
    await expect(page.getByText("Not started")).toBeVisible();
    marcoLink = await inviteLink(page, "Marco R.");
    expect(marcoLink).toMatch(/\/invite\/[A-Za-z0-9_-]{22}$/);
  });

  test("a member who isn't an admin sees who's invited, but can't create or manage invites", async ({
    page,
  }) => {
    await signInTo(page, MEMBERSHIP_8.ivo);
    await expect(page.getByText("Marco R.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create invite" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Revoke" })).toHaveCount(0);
    await expect(page.getByLabel("Invite link for Marco R.")).toHaveCount(0);
  });

  test("the invitee is greeted by name before typing anything, and opening it records nothing", async ({
    browser,
  }) => {
    await asStranger(browser, async (page) => {
      await page.goto(marcoLink);
      await expect(page.getByRole("heading", { name: "Hi Marco" })).toBeVisible();
      await expect(page.getByText(`${DISPLAY_NAME_8.hana} invited you to Eighth Club.`)).toBeVisible();
    });
    // Link previews in group chats are exactly this GET.
    const row = await inviteRow(marcoLink.split("/invite/")[1]);
    expect(row.startedAt).toBeNull();
    expect(row.redeemedAt).toBeNull();
  });

  test("the invitee signs up by code, names themselves, and lands in the club", async ({ browser }) => {
    const email = "marco.invitee@example.com";
    await asStranger(browser, async (page) => {
      await page.goto(marcoLink);
      await page.getByLabel("Your email").fill(email);
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page).toHaveURL(/\/login\/code/);
      const { code } = await setKnownSignIn(email);
      await page.getByLabel("6-digit code").fill(code);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();

      // Name step, prefilled with what Hana typed — a greeting only.
      await expect(page).toHaveURL(/\/welcome/);
      await expect(page.getByLabel("First name")).toHaveValue("Marco");
      await expect(page.getByLabel("Last initial")).toHaveValue("R");
      await page.getByLabel("First name").fill("Marcus");
      await page.getByRole("button", { name: "Continue" }).click();

      await expect(page).toHaveURL(new RegExp(`${CLUB_8_URL}\\?joined=1`));
      await expect(page.getByText("You're in, Marcus.")).toBeVisible();
      await expect(page.getByText("You are: Marcus R.")).toBeVisible();
    });
    const row = await inviteRow(marcoLink.split("/invite/")[1]);
    expect(row.startedAt).not.toBeNull();
    expect(row.redeemedAt).not.toBeNull();
  });

  test("once used, the link says so — and the seat it held is now a member's", async ({ page, browser }) => {
    await asStranger(browser, async (stranger) => {
      await stranger.goto(marcoLink);
      await expect(
        stranger.getByRole("heading", { name: "Marco's invite has already been used" }),
      ).toBeVisible();
    });
    await signInTo(page, MEMBERSHIP_8.hana);
    await expect(page.getByText("3 of 6 seats.")).toBeVisible();
    await expect(page.locator("main h2:has-text('Members') + p")).toContainText("Marcus R.");
  });

  test("revoking one person's invite kills that link and no one else's (Ruling C)", async ({
    page,
    browser,
  }) => {
    await signInTo(page, MEMBERSHIP_8.hana);
    await createInvite(page, "Pat", "q");
    const patLink = await inviteLink(page, "Pat Q.");
    await createInvite(page, "Lee", "s");
    const leeLink = await inviteLink(page, "Lee S.");

    await page
      .locator(".card", { hasText: "Pat Q." })
      .getByRole("button", { name: "Revoke" })
      .click();
    await expect(page.getByLabel("Invite link for Pat Q.")).toHaveCount(0);

    await asStranger(browser, async (stranger) => {
      await stranger.goto(patLink);
      await expect(stranger.getByRole("heading", { name: "This invite link was replaced" })).toBeVisible();
      await expect(stranger.getByText(`Ask ${DISPLAY_NAME_8.hana} for a new one.`)).toBeVisible();
      await stranger.goto(leeLink);
      await expect(stranger.getByRole("heading", { name: "Hi Lee" })).toBeVisible();
    });
  });

  test("regenerating replaces the link, same person, and the old one dies", async ({ page, browser }) => {
    await signInTo(page, MEMBERSHIP_8.hana);
    const oldLink = await inviteLink(page, "Lee S.");
    await page
      .locator(".card", { hasText: "Lee S." })
      .getByRole("button", { name: "Regenerate" })
      .click();
    await expect(page).toHaveURL(/\?invite=/);
    const newLink = await inviteLink(page, "Lee S.");
    expect(newLink).not.toBe(oldLink);

    await asStranger(browser, async (stranger) => {
      await stranger.goto(oldLink);
      await expect(stranger.getByRole("heading", { name: "This invite link was replaced" })).toBeVisible();
      await stranger.goto(newLink);
      await expect(stranger.getByRole("heading", { name: "Hi Lee" })).toBeVisible();
    });
  });

  test("the owner opening their own pending invite is told they're in, and it stays pending", async ({
    page,
  }) => {
    await signInTo(page, MEMBERSHIP_8.hana);
    const leeLink = await inviteLink(page, "Lee S.");
    await page.goto(leeLink);
    await expect(page.getByRole("heading", { name: "You're already in Eighth Club" })).toBeVisible();
    await page.goto(CLUB_8_URL);
    await expect(page.getByLabel("Invite link for Lee S.")).toBeVisible();
  });

  test("signed in as someone else: 'sign out and continue' leaves the invite for its person (Ruling B)", async ({
    page,
    browser,
  }) => {
    const leeLink = await (async () => {
      const ctx = await browser.newContext();
      const owner = await ctx.newPage();
      await signInTo(owner, MEMBERSHIP_8.hana);
      const link = await inviteLink(owner, "Lee S.");
      await ctx.close();
      return link;
    })();

    await signInTo(page, MEMBERSHIP_2.nadia, leeLink);
    await expect(page.getByRole("heading", { name: "This invite is for Lee" })).toBeVisible();
    await expect(page.getByText("You're signed in as")).toBeVisible();
    await page.getByRole("button", { name: "Sign out and continue as Lee" }).click();
    // Signed out now: the ordinary landing, invite untouched.
    await expect(page.getByRole("heading", { name: "Hi Lee" })).toBeVisible();
    await expect(page.getByLabel("Your email")).toBeVisible();
    expect((await inviteRow(leeLink.split("/invite/")[1])).redeemedAt).toBeNull();
  });

  test("signed in as someone else: 'join as me' joins under their own name, never the invitee's", async ({
    page,
    browser,
  }) => {
    const leeLink = await (async () => {
      const ctx = await browser.newContext();
      const owner = await ctx.newPage();
      await signInTo(owner, MEMBERSHIP_8.hana);
      const link = await inviteLink(owner, "Lee S.");
      await ctx.close();
      return link;
    })();

    // Chris's account predates users.display_name; his club 1 name fills it.
    await signInTo(page, MEMBERSHIP.chris, leeLink);
    await page.getByRole("button", { name: /^Join Eighth Club as .* instead$/ }).click();
    await expect(page).toHaveURL(new RegExp(`${CLUB_8_URL}\\?joined=1`));
    await expect(page.getByText("You are: Chris")).toBeVisible();
    await expect(page.getByText("You're in, Chris.")).toBeVisible();
  });

  test("a full club: the landing admits no one, and the owner can't create more", async ({
    page,
    browser,
  }) => {
    await asStranger(browser, async (stranger) => {
      await stranger.goto(`/invite/${FULL_CLUB_INVITE.token}`);
      await expect(stranger.getByRole("heading", { name: "Movie Night Crew is full right now" })).toBeVisible();
    });
    await signInTo(page, MEMBERSHIP.chris, `/clubs/${CLUB_ID}`);
    await expect(
      page.getByText("Movie Night Crew is full: 6 members and 1 pending invite."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Create invite" })).toHaveCount(0);
  });

  test("an unknown token reads the same as a replaced one", async ({ page }) => {
    await page.goto("/invite/not-a-real-token");
    await expect(page.getByRole("heading", { name: "This invite link was replaced" })).toBeVisible();
  });
});
