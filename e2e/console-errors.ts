import type { Page } from "@playwright/test";

// Zero tolerance by default. Add an entry only for a specific,
// understood, harmless message — never a broad pattern that could mask
// a real regression later. Empty on purpose; nothing has earned a spot
// here yet.
export const IGNORED_CONSOLE_ERRORS: RegExp[] = [];

function isIgnored(text: string): boolean {
  return IGNORED_CONSOLE_ERRORS.some((pattern) => pattern.test(text));
}

// Attaches console/page-error listeners to `page` and returns the array
// they append to. Works for any page — the default fixture-provided one
// or one created manually via browser.newContext(), which the auto
// fixture in fixtures.ts can't see.
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    if (isIgnored(msg.text())) return;
    errors.push(msg.text());
  });

  page.on("pageerror", (err) => {
    const text = err.stack ?? err.message;
    if (isIgnored(text)) return;
    errors.push(text);
  });

  return errors;
}
