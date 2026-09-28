import type { Page } from "@playwright/test";
import { CLUB_7_ID, DISPLAY_NAME_7 } from "../db/seed-fixtures";
import { expect, test } from "./fixtures";
import { finishCodeSignIn, latestSignInRow, setKnownSignIn } from "./signIn";

const CLUB_7_URL = `/clubs/${CLUB_7_ID}`;

// No BREVO_API_KEY in E2E (CLAUDE.md — same fixture-fallback shape as
// TMDB_READ_TOKEN), so no email is ever actually sent. Codes and link
// tokens are stored only as hashes, so tests set a known code on the
// newest sign-in row instead of reading one (e2e/signIn.ts).
async function requestCode(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page).toHaveURL(/\/login\/code/);
}

// Club 7 (Wes/Uma, db/seed.ts), both with accounts. Serial, like the
// rest of the suite.
test.describe.configure({ mode: "serial" });

test.describe("auth — recovery", () => {
  test("a brand-new browser signs back in by email and is recognized in every club", async ({
    browser,
  }) => {
    const newContext = await browser.newContext();
    const newPage = await newContext.newPage();
    try {
      // Genuinely fresh — no session cookie at all, standing in for a new
      // device. users.email is the durable anchor (CLAUDE.md).
      await requestCode(newPage, "uma@example.com");
      await finishCodeSignIn(newPage, "uma@example.com");
      // A bare /login request (no returnTo) lands on home, which lists
      // exactly her own club.
      await expect(newPage).toHaveURL("/");
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
