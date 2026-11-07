import { CLUB_2_ID, CLUB_ID } from "../db/seed-fixtures";
import { expect, test } from "./fixtures";
import { finishCodeSignIn, nameYourself } from "./signIn";

// The signed-out / is the marketing page (docs/onboarding-spec.md §5.2,
// rebuild step 5d). It used to select every row in `clubs` and link each
// one — any visitor could see every club's name and walk into its page —
// so it must still list nothing. (Signed in, / lists only the session
// user's own clubs: home-cards.spec.ts and auth.spec.ts.)
test.describe("home page, signed out", () => {
  test("the pitch, its two actions, and no clubs", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Kinomato — Whose turn is it?");
    await expect(page.getByRole("heading", { level: 1, name: "Whose turn is it?" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
    await expect(page.locator("ol.steps > li")).toHaveCount(3);
    await expect(
      page.getByText(
        "Every rating on Kinomato comes from a real person who watched the film with people they know.",
      ),
    ).toBeVisible();

    const start = page.locator("main").getByRole("link", { name: "Start a club" });
    await expect(start).toBeVisible();
    const startHref = new URL((await start.getAttribute("href"))!, page.url());
    expect(startHref.pathname).toBe("/login");
    expect(startHref.searchParams.get("returnTo")).toBe("/new");
    expect([...startHref.searchParams.keys()]).toEqual(["returnTo"]);
    await expect(page.locator("main").getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    // Sign in at the right of the top bar, and no global nav.
    await expect(page.getByRole("banner").getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);

    // Lists no clubs.
    await expect(page.locator('a[href^="/clubs/"]')).toHaveCount(0);
    await expect(page.getByText("Movie Night Crew")).toHaveCount(0);
    await expect(page.locator(`a[href="/clubs/${CLUB_ID}"]`)).toHaveCount(0);
    await expect(page.locator(`a[href="/clubs/${CLUB_2_ID}"]`)).toHaveCount(0);

    // Privacy and Terms in the footer, and nowhere else (onboarding-spec
    // §11.1; launch-foundations step (a)).
    const legal = page.getByRole("navigation", { name: "Legal" });
    await expect(legal.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    await expect(legal.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    await expect(page.locator('a[href*="/privacy"], a[href*="/terms"]')).toHaveCount(2);
  });

  test("nothing third-party: every script and every request is same-origin", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await page.goto("/", { waitUntil: "networkidle" });
    const origin = new URL(page.url()).origin;

    const scriptSrcs = await page.locator("script[src]").evaluateAll((els) =>
      els.map((el) => (el as HTMLScriptElement).src),
    );
    expect(scriptSrcs.length).toBeGreaterThan(0);
    for (const src of scriptSrcs) expect(new URL(src).origin, src).toBe(origin);
    for (const url of requests) expect(new URL(url).origin, url).toBe(origin);
    await expect(page.locator("img, iframe")).toHaveCount(0);
  });

  test("the sample Tonight card is decorative, with a one-line label", async ({ page }) => {
    await page.goto("/");
    // Desktop Chrome is 1280px: the two-column layout shows it.
    const art = page.locator("figure.hero-art");
    await expect(art.locator("[aria-hidden='true']")).toBeVisible();
    await expect(art.locator("[aria-hidden='true']")).toContainText("Saturday Club");
    await expect(art.locator("figcaption")).toHaveText("Example of a club's Tonight card");

    // Phone: one column, and no illustration.
    await page.setViewportSize({ width: 375, height: 800 });
    await expect(art).toBeHidden();
    await expect(page.locator("main").getByRole("link", { name: "Start a club" })).toBeVisible();
  });

  test("Start a club, then signing in, lands on /new", async ({ page }) => {
    const email = "marketing-start@example.com";
    await page.goto("/");
    await page.locator("main").getByRole("link", { name: "Start a club" }).click();
    await expect(page).toHaveURL("/login?returnTo=%2Fnew");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send code" }).click();
    await finishCodeSignIn(page, email);
    await nameYourself(page, "Mae", "W");
    await expect(page).toHaveURL("/new");
    await expect(page.getByLabel("Club name")).toBeVisible();
  });
});
