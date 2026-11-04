import { expect, type Page } from "@playwright/test";

// Who the page thinks you are. "You are: …" is gone (rebuild step 5c):
// identity is the account, and your own row is marked "(you)". On Tonight
// that row is in the rail, which shows from 1120px — Desktop Chrome's
// 1280px viewport, the default in this suite.
export async function expectYouAre(page: Page, name: string): Promise<void> {
  await expect(
    page.getByRole("complementary", { name: "Club context" }).getByText(`${name} (you)`, { exact: true }),
  ).toBeVisible();
}

// The Members tab's member names, in order, each with "(you)" on the
// viewer's own row.
export function memberNames(page: Page) {
  return page.locator("main .member-name");
}
