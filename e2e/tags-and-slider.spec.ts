import type { Page } from "@playwright/test";
import { CLUB_6_ID, DISPLAY_NAME_6 } from "../db/seed-fixtures";
import { expect, test } from "./fixtures";

const CLUB_6_URL = `/clubs/${CLUB_6_ID}`;

async function pickIdentity(page: Page, name: string) {
  await page.goto(CLUB_6_URL);
  await page.getByRole("button", { name, exact: true }).click();
}

// Club 6 (Nora/Iris, db/seed.ts) seeds settings.confirmAt: "manual_only"
// and a scheduledAt two days in the *future* — under the default
// "morning_after" the confirmation prompt couldn't possibly be showing
// yet, so seeing it anyway is exactly what proves confirmAt (not a
// fixed "past scheduled_at" rule) controls the timing. Serial: each
// step is a one-way transition (confirm, then rate) the next builds on.
test.describe.configure({ mode: "serial" });

test.describe("club 6 — confirmAt timing, slider sync, tag autocomplete", () => {
  test("manual_only shows the confirmation prompt despite a future scheduledAt", async ({
    page,
  }) => {
    await pickIdentity(page, DISPLAY_NAME_6.nora);
    await expect(
      page.getByRole("heading", { name: "Did you watch Hereditary?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Yes", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Did you watch Hereditary?" }),
    ).not.toBeVisible();
  });

  test("the quality slider and its paired number input stay in sync, live", async ({
    page,
  }) => {
    await pickIdentity(page, DISPLAY_NAME_6.nora);
    await expect(page.getByRole("heading", { name: "Rate Hereditary" })).toBeVisible();

    const slider = page.getByRole("slider", { name: "Quality" });
    const numberInput = page.getByLabel("Quality (as a number)");

    // Typing in the number input moves the slider (and the live number
    // beside it) — both are views onto the same React state
    // (RatingSlider.tsx), not two independently-tracked values.
    await numberInput.fill("8.5");
    await expect(slider).toHaveValue("8.5");
    await expect(page.getByText("8.5", { exact: true })).toBeVisible();

    // Dragging the slider moves the number input back — a real
    // keyboard-driven change (not a raw DOM value assignment, which
    // React's synthetic event system wouldn't pick up) fires a proper
    // input event.
    await slider.focus();
    await slider.press("Home"); // 0
    await slider.press("ArrowRight"); // 0.5, one step
    await slider.press("ArrowRight"); // 1
    await expect(numberInput).toHaveValue("1");
    await expect(page.getByText("1", { exact: true })).toBeVisible();
  });

  test("Nora submits her rating and adds a tag", async ({ page }) => {
    await pickIdentity(page, DISPLAY_NAME_6.nora);
    await page.getByLabel("Quality (as a number)").fill("9");
    await page.getByLabel("Fun (as a number)").fill("7");
    await page.getByLabel("One-line take (optional)").fill("Unbearable, in a good way.");
    await page.getByRole("button", { name: "Submit rating" }).click();

    await expect(page.getByRole("heading", { name: "Your tags" })).toBeVisible();
    await page.getByPlaceholder("Add a tag").fill("Deeply Unsettling");
    await page.getByRole("button", { name: "Add tag" }).click();

    // Normalized (lib/tags.ts) to "deeply unsettling" for matching, but
    // displayed in the first-seen casing Nora actually typed. Not
    // exact: the tag's own text node shares a list item with its
    // "remove" button, so there's no single element whose full text is
    // just the tag name.
    await expect(page.getByText("Deeply Unsettling")).toBeVisible();
  });

  test("Iris rates second, and Nora's tag is already there as autocomplete", async ({
    page,
  }) => {
    await pickIdentity(page, DISPLAY_NAME_6.iris);
    await expect(page.getByRole("heading", { name: "Rate Hereditary" })).toBeVisible();

    await page.getByLabel("Quality (as a number)").fill("6");
    await page.getByLabel("Fun (as a number)").fill("5");
    await page.getByRole("button", { name: "Submit rating" }).click();

    // The add-tag input's <datalist> is club-scoped autocomplete
    // (CLAUDE.md: "reuse over invention is the whole point") — Nora's
    // tag, added on her own rating, shows up here on Iris's, before
    // Iris has typed anything herself.
    await expect(page.locator("#club-tag-options option[value='Deeply Unsettling']")).toHaveCount(
      1,
    );

    // Both have now rated — blind reveal completes, and Nora's tag
    // shows on her revealed rating too.
    await expect(page.getByText(/Nora.*quality 9\.0, fun 7\.0/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Deeply Unsettling" })).toBeVisible();
  });
});
