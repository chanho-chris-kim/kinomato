import type { Page } from "@playwright/test";

// Tonight since the redesign (2026-11-25): "Whose turn" isn't a heading;
// the side column (the rail, shown at Desktop Chrome's 1280px) names who
// the club is waiting on, getWhoseTurn's answer.
export function whoseTurn(page: Page) {
  return page.getByRole("complementary", { name: "Club context" }).locator(".whose-turn");
}
