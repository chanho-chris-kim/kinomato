import type { Page } from "@playwright/test";
import { CLUB_3_ID, CLUB_4_ID, DISPLAY_NAME_3, DISPLAY_NAME_4 } from "../db/seed-fixtures";
import { expect, test } from "./fixtures";

const CLUB_3_URL = `/clubs/${CLUB_3_ID}`;
const CLUB_4_URL = `/clubs/${CLUB_4_ID}`;

async function pickIdentity(page: Page, url: string, name: string) {
  await page.goto(url);
  await page.getByRole("button", { name, exact: true }).click();
}

// Playwright's locator.fill() doesn't support type=range — these are
// uncontrolled native inputs (no React state), so setting the DOM value
// directly is enough for the surrounding <form>'s FormData to pick it
// up on submit.
async function setSlider(page: Page, label: string, value: string) {
  await page.getByLabel(label).evaluate((el, v) => {
    (el as HTMLInputElement).value = v;
  }, value);
}

// Club 3 (Leo/Mika/Theo, db/seed.ts) has a "locked" night, scheduled
// yesterday, with a winner already set — standing in for a night that
// went through voting and lock (no lock UI exists yet). Leo RSVP'd no,
// so he's the picker but not an attendee; Mika and Theo both RSVP'd yes,
// which is what the blind-reveal test needs two of. Serial: confirming
// and rating are one-way transitions these tests build on in order.
test.describe.configure({ mode: "serial" });

test.describe("confirmation — watched path (club 3)", () => {
  test("the picker sees a past-due, unconfirmed night's prompt", async ({ page }) => {
    await pickIdentity(page, CLUB_3_URL, DISPLAY_NAME_3.leo);
    await expect(page.getByRole("heading", { name: "Did you watch Get Out?" })).toBeVisible();
  });

  test("a non-picker sees the same prompt — anyone in the club can answer", async ({ page }) => {
    await pickIdentity(page, CLUB_3_URL, DISPLAY_NAME_3.mika);
    await expect(page.getByRole("heading", { name: "Did you watch Get Out?" })).toBeVisible();
  });

  test("Mika answers yes, settling it", async ({ page }) => {
    await pickIdentity(page, CLUB_3_URL, DISPLAY_NAME_3.mika);
    await page.getByRole("button", { name: "Yes", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Did you watch Get Out?" }),
    ).not.toBeVisible();
  });

  test("first answer wins — Theo's later visit sees no prompt to answer", async ({ page }) => {
    await pickIdentity(page, CLUB_3_URL, DISPLAY_NAME_3.theo);
    await expect(
      page.getByRole("heading", { name: "Did you watch Get Out?" }),
    ).not.toBeVisible();
  });

  test("a watched night's picker has already handed off — whose turn shows the next member", async ({
    page,
  }) => {
    await pickIdentity(page, CLUB_3_URL, DISPLAY_NAME_3.leo);
    await expect(page.getByText(DISPLAY_NAME_3.mika)).toBeVisible();
  });

  test("the picker (RSVP'd no) sees no rating form, but sees the hidden-count progress", async ({
    page,
  }) => {
    await pickIdentity(page, CLUB_3_URL, DISPLAY_NAME_3.leo);
    await expect(page.getByRole("heading", { name: "Rate Get Out" })).toBeVisible();
    await expect(page.getByRole("slider", { name: "Quality" })).not.toBeVisible();
    await expect(page.getByText("0/2 ratings in")).toBeVisible();
  });

  test("Mika rates first — her take stays hidden, even from herself, until Theo also rates", async ({
    page,
  }) => {
    await pickIdentity(page, CLUB_3_URL, DISPLAY_NAME_3.mika);
    await setSlider(page, "Quality", "8");
    await setSlider(page, "Fun", "7");
    await page.getByLabel("One-line take (optional)").fill("Amazing");
    await page.getByRole("button", { name: "Submit rating" }).click();

    await expect(page.getByRole("heading", { name: "Rate Get Out" })).toBeVisible();
    await expect(page.getByLabel("Quality")).not.toBeVisible();
    await expect(page.getByText("1/2 ratings in")).toBeVisible();
    await expect(page.getByText("Amazing")).not.toBeVisible();
  });

  test("Theo rates second — the last rating lands and both takes reveal together", async ({
    page,
  }) => {
    await pickIdentity(page, CLUB_3_URL, DISPLAY_NAME_3.theo);
    await expect(page.getByLabel("Quality")).toBeVisible();
    await setSlider(page, "Quality", "6");
    await setSlider(page, "Fun", "9");
    await page.getByRole("button", { name: "Submit rating" }).click();

    await expect(page.getByText(/Mika.*quality 8\.0, fun 7\.0/)).toBeVisible();
    await expect(page.getByText("Amazing")).toBeVisible();
    await expect(page.getByText(/Theo.*quality 6\.0, fun 9\.0/)).toBeVisible();
  });

  test("the non-attending picker also sees the reveal once it lands — history is shared", async ({
    page,
  }) => {
    await pickIdentity(page, CLUB_3_URL, DISPLAY_NAME_3.leo);
    await expect(page.getByText("Amazing")).toBeVisible();
  });
});

test.describe("confirmation — cancellation path (club 4)", () => {
  test("before confirmation, the picker's night already counts — whose turn shows Ana", async ({
    page,
  }) => {
    await pickIdentity(page, CLUB_4_URL, DISPLAY_NAME_4.vik);
    await expect(page.getByText(DISPLAY_NAME_4.ana)).toBeVisible();
  });

  test("Vik says the club didn't meet, cancelling the night", async ({ page }) => {
    await pickIdentity(page, CLUB_4_URL, DISPLAY_NAME_4.vik);
    await page.getByRole("button", { name: "We didn't meet" }).click();
    await expect(
      page.getByRole("heading", { name: "Did you watch Arrival?" }),
    ).not.toBeVisible();
  });

  test("a cancelled night doesn't consume the turn — Vik is up next again", async ({ page }) => {
    await pickIdentity(page, CLUB_4_URL, DISPLAY_NAME_4.ana);
    await expect(page.getByText("Whose turn")).toBeVisible();
    await expect(page.locator("main")).toContainText(DISPLAY_NAME_4.vik);
  });
});
