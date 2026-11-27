import { expect, type Locator, type Page } from "@playwright/test";

// Submits a form and waits until that submission's page has rendered: its
// POST answered, then the form reset by the re-render (React resets an
// uncontrolled form once its action is done). Needed wherever the outcome
// reads the same as the one before ("That code didn't work." twice): an
// expect on that text passes at once against the old page, the test fills
// and submits again before the last one has landed, and the re-render can
// reset the form under it. `resets` is a field the test filled, which the
// re-render empties.
export async function submitAndSettle(page: Page, button: Locator, resets: Locator): Promise<void> {
  const answered = page.waitForResponse((r) => r.request().method() === "POST");
  await button.click();
  await answered;
  await expect(resets).toHaveValue("");
}
