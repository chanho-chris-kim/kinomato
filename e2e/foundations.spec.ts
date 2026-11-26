import type { Locator } from "@playwright/test";
import { CLUB_ID, MEMBERSHIP } from "../db/seed-fixtures";
import { expect, test } from "./fixtures";
import { signInAs } from "./session";

// Design foundations (2026-11-24): a field shows a focus ring, and
// buttons, tabs and fields are at least 44px targets. The colour ratios
// are in app/globals.css beside the tokens.

async function size(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not rendered");
  return box;
}

test.describe("design foundations", () => {
  test("a focused text field shows a ring around the field", async ({ page }) => {
    await page.goto("/login");
    const field = page.locator(".search").first();
    // /login focuses the field on load: move focus off it first.
    await page.getByLabel("Email").blur();
    await expect(field).toHaveCSS("outline-style", "none");
    await page.getByLabel("Email").focus();
    await expect(field).toHaveCSS("outline-style", "solid");
    await expect(field).toHaveCSS("outline-width", "2px");
  });

  test("buttons, fields and club tabs are at least 44px tall", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/login");
    expect((await size(page.getByRole("button", { name: "Send my code" }))).height).toBeGreaterThanOrEqual(44);
    expect((await size(page.getByLabel("Email"))).height).toBeGreaterThanOrEqual(44);

    await signInAs(page, MEMBERSHIP.dana);
    await page.goto(`/clubs/${CLUB_ID}`);
    for (const tab of await page.getByRole("navigation", { name: "Club" }).getByRole("link").all()) {
      expect((await size(tab)).height).toBeGreaterThanOrEqual(44);
    }
  });
});
