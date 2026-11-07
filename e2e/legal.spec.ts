import type { Page } from "@playwright/test";
import { CLUB_ID, MEMBERSHIP } from "../db/seed-fixtures";
import { LEGAL } from "../lib/legal";
import { expect, test } from "./fixtures";
import { signInAs } from "./session";

// The draft legal pages (docs/onboarding-spec.md §11.1; launch-foundations
// step (a)): public, versioned in lib/legal.ts, a draft notice while
// unreviewed, linked from every page's footer, and nothing third-party.
const PAGES = [
  { path: "/terms", title: "Terms", doc: LEGAL.terms },
  { path: "/privacy", title: "Privacy", doc: LEGAL.privacy },
];

async function expectLegalPage(page: Page, title: string, version: string) {
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.locator(".legal-draft")).toContainText("Draft — not yet reviewed.");
  await expect(page.locator(".legal-version")).toHaveText(version);
  // Placeholders only: every section says its text is pending review.
  const sections = page.locator("main section");
  expect(await sections.count()).toBeGreaterThan(3);
  for (const section of await sections.all()) await expect(section).toContainText("Text pending legal review.");
}

function legalLinks(page: Page) {
  return page.getByRole("navigation", { name: "Legal" }).getByRole("link");
}

test.describe("legal pages", () => {
  for (const { path, title, doc } of PAGES) {
    test(`${path} signed out: public, draft notice, version, no global nav`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page).toHaveURL(path);
      await expectLegalPage(page, title, doc.version);
      await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
      await expect(page.locator('head meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
    });

    test(`${path} signed in: the same page in the global shell, nothing current`, async ({ page }) => {
      await signInAs(page, MEMBERSHIP.dana);
      await page.goto(path);
      await expectLegalPage(page, title, doc.version);
      const nav = page.getByRole("navigation", { name: "Main" });
      await expect(nav.getByRole("link")).toHaveText(["Clubs", "Watchlist", "Settings"]);
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(0);
    });

    test(`${path} makes only same-origin requests`, async ({ page }) => {
      const requests: string[] = [];
      page.on("request", (r) => requests.push(r.url()));
      await page.goto(path, { waitUntil: "networkidle" });
      const origin = new URL(page.url()).origin;
      const scriptSrcs = await page.locator("script[src]").evaluateAll((els) =>
        els.map((el) => (el as HTMLScriptElement).src),
      );
      for (const src of scriptSrcs) expect(new URL(src).origin, src).toBe(origin);
      for (const url of requests) expect(new URL(url).origin, url).toBe(origin);
      await expect(page.locator("img, iframe")).toHaveCount(0);
    });
  }

  test("the Privacy page lists its processors as facts", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.locator(".processors li")).toHaveText([
      /^Brevo \(France\): email delivery/,
      /^Neon: the database/,
      /^Cloudflare: hosting; it sees every request and stores request logs/,
      /^TMDB: film data; it receives film lookups and the search text you type/,
    ]);
    // No contact address in the page: reply to any Kinomato email.
    await expect(page.getByText("For now, reply to any Kinomato email.")).toBeVisible();
    await expect(page.locator("main")).not.toContainText("@");
  });

  test("footer links on /, a club page and /settings", async ({ page }) => {
    await page.goto("/");
    await expect(legalLinks(page)).toHaveText(["Privacy", "Terms"]);
    await signInAs(page, MEMBERSHIP.dana);
    for (const path of ["/", `/clubs/${CLUB_ID}`, "/settings"]) {
      await page.goto(path);
      await expect(legalLinks(page)).toHaveText(["Privacy", "Terms"]);
      await expect(legalLinks(page).nth(0)).toHaveAttribute("href", "/privacy");
      await expect(legalLinks(page).nth(1)).toHaveAttribute("href", "/terms");
    }
    await legalLinks(page).nth(1).click();
    await expect(page).toHaveURL("/terms");
  });
});
