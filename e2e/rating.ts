import type { Page } from "@playwright/test";

// Sets a rating slider (app/clubs/[clubId]/RatingSlider.tsx) the way a
// person does with a keyboard: Home to 0, then one ArrowRight per half
// point. Real input events, so the value beside the label follows. Since
// the Tonight redesign (2026-11-25) there's no number box to type into.
export async function setScore(page: Page, label: "Quality" | "Fun", value: string | number): Promise<void> {
  const slider = page.getByRole("slider", { name: label, exact: true });
  await slider.focus();
  await slider.press("Home");
  for (let i = 0; i < Math.round(Number(value) * 2); i++) await slider.press("ArrowRight");
}
