import { CLUB_2_ID, CLUB_ID } from "../db/seed-fixtures";
import { expect, test } from "./fixtures";

// `/` used to select every row in `clubs` and link each one — any visitor
// could see every club's name and walk into its page. Signed out, it must
// list nothing. (Signed in, it lists only the session user's own clubs:
// covered at the end of auth.spec.ts's fresh-login test, which is where a
// real session already exists.)
test.describe("home page", () => {
  test("signed out, / lists no clubs", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Start a club" })).toBeVisible();
    await expect(page.locator('a[href^="/clubs/"]')).toHaveCount(0);
    await expect(page.getByText("Movie Night Crew")).toHaveCount(0);
    await expect(page.locator(`a[href="/clubs/${CLUB_ID}"]`)).toHaveCount(0);
    await expect(page.locator(`a[href="/clubs/${CLUB_2_ID}"]`)).toHaveCount(0);
  });
});
