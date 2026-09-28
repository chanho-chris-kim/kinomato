import { CLUB_8_ID, CLUB_ID, DISPLAY_NAME_8, MEMBERSHIP, MEMBERSHIP_8 } from "../db/seed-fixtures";
import { expect, test } from "./fixtures";
import { signInAs } from "./session";
import { finishCodeSignIn } from "./signIn";

// Who can see what (docs/onboarding-spec.md §5.1, rebuild step 4): every
// club route and /new need a session; a club also needs an active
// membership, and anyone else gets a 404, not a 403. The old per-club
// identity cookie opens nothing any more.
test.describe("gating", () => {
  for (const path of [`/clubs/${CLUB_ID}`, `/clubs/${CLUB_ID}/list`, `/clubs/${CLUB_ID}/tags/cozy`, "/new"]) {
    test(`signed out, ${path.replace(CLUB_ID, "<club>")} sends you to sign in, remembering where you were`, async ({
      page,
    }) => {
      await page.goto(path);
      await expect(page).toHaveURL(`/login?${new URLSearchParams({ returnTo: path })}`);
    });
  }

  test("signing in from a gated page lands back on it", async ({ page }) => {
    const path = `/clubs/${CLUB_8_ID}`;
    await page.goto(path);
    await page.getByLabel("Email").fill("ivo@example.com");
    await page.getByRole("button", { name: "Send code" }).click();
    await finishCodeSignIn(page, "ivo@example.com");
    await expect(page).toHaveURL(path);
    await expect(page.getByText(`You are: ${DISPLAY_NAME_8.ivo}`)).toBeVisible();
  });

  test("signed in, a club you're not in is a 404 — indistinguishable from one that doesn't exist", async ({
    page,
  }) => {
    await signInAs(page, MEMBERSHIP_8.hana);
    // The context's request API carries the same session cookie, without
    // the browser logging the 404 as a console error.
    const notMine = await page.request.get(`/clubs/${CLUB_ID}`, { maxRedirects: 0 });
    expect(notMine.status()).toBe(404);
    const missing = await page.request.get("/clubs/00000000-0000-0000-0000-000000000000", {
      maxRedirects: 0,
    });
    expect(missing.status()).toBe(404);
    // And a club Hana is in is a 200, so this isn't a blanket 404.
    const mine = await page.request.get(`/clubs/${CLUB_8_ID}`, { maxRedirects: 0 });
    expect(mine.status()).toBe(200);
  });

  test("a leftover per-club identity cookie, with no session, opens nothing", async ({ page }) => {
    await page.context().addCookies([
      {
        name: `kinomato_identity_${CLUB_ID}`,
        value: MEMBERSHIP.chris,
        url: test.info().project.use.baseURL!,
      },
    ]);
    await page.goto(`/clubs/${CLUB_ID}`);
    await expect(page).toHaveURL(/\/login\?returnTo=/);
  });
});
