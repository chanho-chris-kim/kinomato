import type { Page } from "@playwright/test";
import { CLUB_7_ID, DISPLAY_NAME_7 } from "../db/seed-fixtures";
import { expect, test } from "./fixtures";
import { forgetRecentSends, latestSignInRow, setKnownSignIn } from "./signIn";

const CLUB_7_URL = `/clubs/${CLUB_7_ID}`;
const LIST_7_URL = `${CLUB_7_URL}/list`;

// No BREVO_API_KEY in E2E (CLAUDE.md — same fixture-fallback shape as
// TMDB_READ_TOKEN), so no email is ever actually sent. Codes and link
// tokens are stored only as hashes, so tests set a known code on the
// newest sign-in row instead of reading one (e2e/signIn.ts).
async function enterKnownCode(page: Page, email: string) {
  await expect(page).toHaveURL(/\/login\/code/);
  await expect(page.getByText(email)).toBeVisible();
  const { code } = await setKnownSignIn(email);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function requestCode(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page).toHaveURL(/\/login\/code/);
}

async function pickIdentity(page: Page, url: string, name: string) {
  await page.goto(url);
  await page.getByRole("button", { name, exact: true }).click();
}

// Club 7 (Wes/Uma, db/seed.ts) — Uma starts with a seeded 3-film
// watchlist (the claim-prompt threshold) so this doesn't need to add
// films through the UI first. Serial: claiming is a one-way transition
// later tests build on (recognized via session, not the per-club
// cookie).
test.describe.configure({ mode: "serial" });

test.describe("auth — claim and session recovery", () => {
  test("a guest with 3+ watchlist films sees the claim prompt, naming the list and the rotation", async ({
    page,
  }) => {
    await pickIdentity(page, LIST_7_URL, DISPLAY_NAME_7.uma);
    await expect(page.getByText("Save your spot")).toBeVisible();
    await expect(page.getByText(/lose this list and your place in the rotation/)).toBeVisible();
  });

  test("Uma claims her account (same membership, not a new one), and identity survives clearing the per-club cookie", async ({
    page,
    context,
  }) => {
    await pickIdentity(page, LIST_7_URL, DISPLAY_NAME_7.uma);

    await page.getByPlaceholder("you@example.com").fill("uma@example.com");
    await page.getByRole("button", { name: "Send code" }).click();
    await enterKnownCode(page, "uma@example.com");
    // returnToClubId lands on the club page, not back on the list page
    // the prompt itself was on.
    await expect(page).toHaveURL(CLUB_7_URL);
    await expect(page.getByText(`You are: ${DISPLAY_NAME_7.uma}`)).toBeVisible();

    // Still exactly one Uma in the member list (order isn't guaranteed
    // — no ORDER BY on that query) — claiming updated the existing
    // membership in place (CLAUDE.md), it didn't insert a second one
    // alongside it.
    const memberListText = await page.locator('h2:has-text("Members") + p').textContent();
    const memberNames = memberListText!.split(", ");
    expect(memberNames.filter((n) => n === DISPLAY_NAME_7.uma)).toHaveLength(1);
    expect(memberNames).toHaveLength(2);

    // The prompt is gone now that she's claimed — userId is no longer
    // null, so ClaimPrompt's own guard stops rendering it.
    await page.goto(LIST_7_URL);
    await expect(page.getByText("Save your spot")).not.toBeVisible();

    // Same context, continued: clear only the per-club cookie, keep
    // the session cookie /verify just set — this is exactly
    // getIdentityMembershipId's fallback path (CLAUDE.md): per-club
    // cookie missing, session present, re-derive the same membership
    // via users.id. A separate test can't check this — Playwright
    // isolates cookies per test, and there'd be nothing to clear.
    await page.goto(CLUB_7_URL);
    const allCookies = await context.cookies();
    const perClubCookieName = `kinomato_identity_${CLUB_7_ID}`;
    expect(allCookies.some((c) => c.name === perClubCookieName)).toBe(true);
    const kept = allCookies.filter((c) => c.name !== perClubCookieName);
    await context.clearCookies();
    await context.addCookies(kept);

    await page.reload();
    await expect(page.getByText(`You are: ${DISPLAY_NAME_7.uma}`)).toBeVisible();
  });

  test("a brand-new browser context recovers Uma's identity via a fresh login — no claim, no new membership", async ({
    browser,
  }) => {
    const newContext = await browser.newContext();
    const newPage = await newContext.newPage();
    try {
      // Genuinely fresh — no per-club cookie, no session cookie at all,
      // standing in for a new device.
      // The claim test above sent Uma a code seconds ago; without this
      // the 30-second resend cooldown would (correctly) refuse a new one.
      await forgetRecentSends("uma@example.com");
      await requestCode(newPage, "uma@example.com");
      await enterKnownCode(newPage, "uma@example.com");
      // No returnTo this time (a bare /login request) — lands on the
      // generic home rather than a specific club.
      await expect(newPage).toHaveURL("/");

      // Signed in, / lists exactly the session user's own clubs — Uma's
      // one club, never anyone else's (it used to list every club in the
      // database, to anyone).
      await expect(newPage.locator('a[href^="/clubs/"]')).toHaveCount(1);
      await expect(newPage.getByRole("link", { name: "Seventh Club" })).toHaveAttribute(
        "href",
        CLUB_7_URL,
      );
      await expect(newPage.getByText("Movie Night Crew")).toHaveCount(0);

      await newPage.goto(CLUB_7_URL);
      await expect(newPage.getByText(`You are: ${DISPLAY_NAME_7.uma}`)).toBeVisible();
    } finally {
      await newContext.close();
    }
  });
});

test.describe("auth — unclaimed owner prompt", () => {
  test("Wes (owner, unclaimed) sees the owner-specific prompt regardless of watchlist size", async ({
    page,
  }) => {
    await pickIdentity(page, CLUB_7_URL, DISPLAY_NAME_7.wes);
    await expect(page.getByText("Save your spot")).toBeVisible();
    await expect(page.getByText(/only owner/)).toBeVisible();
  });
});

test.describe("auth — invite token rotation", () => {
  test("rotating invalidates the old link immediately; the new one works", async ({ page }) => {
    await pickIdentity(page, CLUB_7_URL, DISPLAY_NAME_7.wes);
    const oldHref = await page.locator('a[href*="/join?token="]').getAttribute("href");
    expect(oldHref).toBeTruthy();

    await page.getByRole("button", { name: "Rotate invite link" }).click();
    // Wait for the rotation to land (the action revalidates the page, so
    // the rendered link changes) before navigating away. Navigating
    // straight after the click can abort the in-flight server action —
    // it slipped through under next dev's slower responses and failed
    // every time against a production build.
    await expect(page.locator('a[href*="/join?token="]')).not.toHaveAttribute("href", oldHref!);

    await page.goto(oldHref!);
    await expect(page.getByRole("heading", { name: "Invalid invite link" })).toBeVisible();

    // Still Wes in this same context (rotation doesn't touch his own
    // per-club cookie) — no picker to click again.
    await page.goto(CLUB_7_URL);
    const newHref = await page.locator('a[href*="/join?token="]').getAttribute("href");
    expect(newHref).toBeTruthy();
    expect(newHref).not.toBe(oldHref);

    await page.goto(newHref!);
    await expect(page.getByRole("heading", { name: "Seventh Club" })).toBeVisible();
  });
});

// docs/onboarding-spec.md §4: one email, a code and a link, stored only as
// hashes. Fresh addresses per test, so each starts with no sends.
test.describe("auth — sign-in codes and links", () => {
  test("wrong codes count down, then the code locks — even the right one stops working", async ({
    page,
  }) => {
    const email = "wrong-code@example.com";
    await requestCode(page, email);
    await setKnownSignIn(email);
    const wrong = "000000"; // not KNOWN_CODE

    for (const left of ["4 tries", "3 tries", "2 tries", "1 try"]) {
      await page.getByLabel("6-digit code").fill(wrong);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByText(`That code didn't match. ${left} left.`)).toBeVisible();
    }
    await page.getByLabel("6-digit code").fill(wrong);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Too many tries. Send a new code.")).toBeVisible();
    // The code form is gone; only "Send a new code" is left.
    await expect(page.getByLabel("6-digit code")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send a new code" })).toBeVisible();
  });

  test("opening the link doesn't sign in or use it up — only the button does, once", async ({
    page,
  }) => {
    const email = "link-user@example.com";
    await requestCode(page, email);
    const { token } = await setKnownSignIn(email);

    await page.goto(`/verify?token=${token}`);
    await expect(page.getByRole("heading", { name: `Sign in as ${email}` })).toBeVisible();
    // A scanner's prefetch is exactly this GET: nothing consumed.
    expect((await latestSignInRow(email))!.consumedAt).toBeNull();

    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    // A brand-new account names itself once (/welcome), then lands home.
    await expect(page).toHaveURL(/\/welcome/);
    await page.getByLabel("First name").fill("Link");
    await page.getByLabel("Last initial").fill("u");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByText("You're not in any clubs yet.")).toBeVisible();
    expect((await latestSignInRow(email))!.consumedAt).not.toBeNull();

    // Used once; the same link now dead-ends, and so does its code.
    await page.goto(`/verify?token=${token}`);
    await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();
  });

  test("asking again within 30 seconds doesn't send another code", async ({ page }) => {
    const email = "impatient@example.com";
    await requestCode(page, email);
    const first = await latestSignInRow(email);

    await page.getByRole("button", { name: "Resend" }).click();
    await expect(
      page.getByText("We just sent one. Check your inbox, or try again in a minute."),
    ).toBeVisible();
    expect((await latestSignInRow(email))!.id).toBe(first!.id);
  });
});
