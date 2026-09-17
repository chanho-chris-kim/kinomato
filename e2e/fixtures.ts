import { test as base, expect } from "@playwright/test";
import { collectConsoleErrors } from "./console-errors";

// Auto-applies to every test using the default `page` fixture: fails
// the test if the browser logged any console error or uncaught
// exception during it. This is what would have caught the <form>-in-
// <p> hydration error on its own — six tests passed clean while eleven
// hydration errors scrolled by in the logs, which means passing tests
// alone weren't actually the safety net they looked like.
//
// Tests that create their own pages via browser.newContext() (the
// two-browser-contexts scenario) aren't covered by this fixture — call
// collectConsoleErrors() on those pages directly instead.
export const test = base.extend<{ failOnConsoleErrors: void }>({
  failOnConsoleErrors: [
    async ({ page }, use) => {
      const errors = collectConsoleErrors(page);
      await use();
      expect(
        errors,
        `Unexpected browser console error(s):\n\n${errors.join("\n\n")}`,
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
