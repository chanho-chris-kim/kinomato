import type { Page } from "@playwright/test";
import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../db/schema";
import { LEGAL } from "../lib/legal";
import { expect, test } from "./fixtures";
import { signInAsUser } from "./session";

// Start your club, the getting-started list and the invite page (u4,
// §5.13), on the main server (sign-up closed). The flow from "Start a
// club" itself is e2e/start-club.open-signup.spec.ts.

const db = drizzle(neon(process.env.E2E_DATABASE_URL!), { schema });
const id = () => crypto.randomUUID();
const at = new Date(Date.UTC(2026, 0, 1));

async function person(displayName: string, tag: string) {
  const userId = id();
  await db.insert(schema.users).values({
    id: userId,
    email: `${tag}.${userId.slice(0, 8)}@example.com`,
    displayName,
    ageBracket: "18_plus",
    ageAttestedAt: at,
  });
  await db.insert(schema.consentEvents).values(
    (["terms", "privacy"] as const).map((document) => ({
      userId,
      document,
      version: LEGAL[document].version,
      acceptedAt: at,
      method: "signup" as const,
    })),
  );
  return userId;
}

const clubRow = async (clubId: string) => (await db.select().from(schema.clubs).where(eq(schema.clubs.id, clubId)))[0];

// Signed in, through /new with every default as it comes.
async function startClub(page: Page, userId: string, name: string): Promise<string> {
  await signInAsUser(page, userId);
  await page.goto("/new");
  await page.getByLabel("Club name").fill(name);
  await page.getByLabel("Timezone").fill("America/New_York");
  await page.getByRole("button", { name: "Create club" }).click();
  await expect(page).toHaveURL(/\/clubs\/[0-9a-f-]{36}$/);
  return new URL(page.url()).pathname.split("/")[2];
}

const filled = (page: Page) => page.locator("main .btn.primary:visible");
const item = (page: Page, title: RegExp) => page.locator(".checklist-item").filter({ hasText: title });

test.describe("Start your club", () => {
  test("with sign-up closed, the flow isn't reachable and /new has no bar", async ({ page }) => {
    await page.goto("/login/start");
    await expect(page).toHaveURL("/login");
    await expect(page.locator(".signup-steps")).toHaveCount(0);
    const me = await person("Cleo C.", "sc-closed");
    await signInAsUser(page, me);
    await page.goto("/new?start=1");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Start your club");
    await expect(page.locator(".signup-steps")).toHaveCount(0);
  });

  test("every setting is prefilled with today's defaults and saved exactly", async ({ page }) => {
    const me = await person("Dot D.", "sc-defaults");
    await signInAsUser(page, me);
    await page.goto("/new");
    await expect(page.getByText("We've filled in sensible defaults. Change anything you like.")).toBeVisible();
    await expect(page.getByLabel("Usually on")).toHaveValue("6");
    await expect(page.getByLabel("At", { exact: true })).toHaveValue("20:00");
    await expect(page.getByLabel("In person")).toBeChecked();
    await expect(page.getByLabel("How often")).toHaveValue("weekly");
    await expect(page.getByLabel("How often").locator("option")).toHaveText(["Weekly", "Every other week", "Monthly", "No fixed schedule"]);
    await expect(page.getByLabel("First night on")).toBeHidden();
    await expect(page.getByLabel("Films each picker offers")).toHaveValue("3");
    await expect(page.getByLabel(/^Voting closes/)).toHaveValue("24");
    await expect(page.getByLabel("Show vote counts while voting is open")).not.toBeChecked();
    await expect(page.getByLabel(/^Ask .Did you watch it/)).toHaveValue("morning_after");
    await expect(page.getByLabel(/^If nobody answers/)).toHaveValue("48");

    const clubId = await startClub(page, me, "Defaults Club");
    const club = await clubRow(clubId);
    expect([club.cadence, club.defaultDay, club.defaultTime?.slice(0, 5), club.mode, club.timezone]).toEqual([
      "weekly",
      6,
      "20:00",
      "in_person",
      "America/New_York",
    ]);
    expect(club.settings).toEqual({
      nomineesPerTurn: 3,
      lockTime: 24,
      confirmAt: "morning_after",
      autoAdvance: 48,
      showVoteCounts: false,
      gettingStarted: { checked: false, hidden: false },
    });
  });

  test("no fixed schedule is offered and saved, with no first night and no draft", async ({ page }) => {
    const me = await person("Ivo I.", "sc-adhoc");
    await signInAsUser(page, me);
    await page.goto("/new");
    await page.getByLabel("Club name").fill("Loose Start Club");
    await page.getByLabel("Timezone").fill("America/New_York");
    await page.getByLabel("How often").selectOption("ad_hoc");
    await page.getByRole("button", { name: "Create club" }).click();
    await expect(page).toHaveURL(/\/clubs\/[0-9a-f-]{36}$/);
    const clubId = new URL(page.url()).pathname.split("/")[2];
    const club = await clubRow(clubId);
    expect(club.cadence).toBe("ad_hoc");
    expect(club.settings).not.toHaveProperty("scheduleAnchor");
    // Today's ad hoc behaviour: nothing drafted automatically.
    expect(await db.select().from(schema.nights).where(eq(schema.nights.clubId, clubId))).toEqual([]);
  });

  test("the time zone is the device's when it's a listed zone; still required, never overwriting what's typed", async ({
    browser,
  }) => {
    const me = await person("Joy J.", "sc-tz");
    const listed = await browser.newContext({ timezoneId: "America/Chicago" });
    const page = await listed.newPage();
    await signInAsUser(page, me);
    await page.goto("/new");
    await expect(page.getByLabel("Timezone")).toHaveValue("America/Chicago");
    await expect(page.getByLabel("Timezone")).toHaveAttribute("required", "");
    await listed.close();

    // Without script it stays empty, and required.
    const noScript = await browser.newContext({ timezoneId: "America/Chicago", javaScriptEnabled: false });
    const plain = await noScript.newPage();
    await signInAsUser(plain, me);
    await plain.goto("/new");
    await expect(plain.getByLabel("Timezone")).toHaveValue("");
    await expect(plain.getByLabel("Timezone")).toHaveAttribute("required", "");
    await noScript.close();
  });

  test("bad values are refused with the Members tab's own messages, and what was typed comes back", async ({ browser }) => {
    const me = await person("Eli E.", "sc-bad");
    const page = await (await browser.newContext({ timezoneId: "America/Chicago" })).newPage();
    await signInAsUser(page, me);
    await page.goto("/new");
    await page.locator("form.club-details-form").evaluate((f) => f.setAttribute("novalidate", ""));
    await page.getByLabel("Club name").fill("Bad Values Club");
    await page.getByLabel("Timezone").fill("America/New_York");
    await page.getByLabel("Films each picker offers").fill("9");
    await page.getByRole("button", { name: "Create club" }).click();
    await expect(page.locator("main").getByRole("alert")).toHaveText(
      "Films each picker nominates must be a whole number from 1 to 5.",
    );
    await expect(page.getByLabel("Club name")).toHaveValue("Bad Values Club");
    // What was typed comes back, never replaced by the device's zone.
    await expect(page.getByLabel("Timezone")).toHaveValue("America/New_York");

    // Every other week needs a first night (ruled 2026-11-10), as on Members.
    await page.locator("form.club-details-form").evaluate((f) => f.setAttribute("novalidate", ""));
    await page.getByLabel("Films each picker offers").fill("2");
    await page.getByLabel("How often").selectOption("biweekly");
    await expect(page.getByLabel("First night on")).toBeVisible();
    await page.getByRole("button", { name: "Create club" }).click();
    await expect(page.locator("main").getByRole("alert")).toHaveText("Pick the date of the first night.");
    await expect(page.getByLabel("How often")).toHaveValue("biweekly");
    await expect(page.getByLabel("Films each picker offers")).toHaveValue("2");
  });
});

test.describe("Get {club} going", () => {
  test("only the owner sees it; each item completes on its real condition; one filled button; gone when done", async ({
    page,
    browser,
  }) => {
    const owner = await person("Fay F.", "sc-owner");
    const clubId = await startClub(page, owner, "Going Club");

    await expect(page.locator(".getting-started .eyebrow")).toHaveText("Your club is ready");
    await expect(page.getByRole("heading", { name: "Get Going Club going" })).toBeVisible();
    await expect(page.locator(".checklist-count")).toHaveText("1 of 4 done. This list goes away once you're set.");
    await expect(item(page, /Create your club/)).toHaveClass(/done/);
    await expect(item(page, /Invite your people/)).toContainText("Up to 5 more. Each gets their own link.");
    await expect(page.locator(".first-night-note")).toContainText("Your first night:");
    await expect(page.locator(".first-night-note")).toContainText("You pick first, since you started the club.");
    // The checklist is the do-this-now card: the page's one filled button
    // is its current item's, and the week's card below has outlined ones.
    await expect(filled(page)).toHaveCount(1);
    await expect(item(page, /Invite your people/).locator(".btn.primary")).toHaveText("Invite people");

    // Invite: done with a pending invite.
    await page.goto(`/clubs/${clubId}/members/invite`);
    await page.getByLabel("Their name").fill("Gus");
    await page.getByRole("button", { name: "Create invite link" }).click();
    await page.goto(`/clubs/${clubId}`);
    await expect(item(page, /Invite your people/)).toHaveClass(/done/);
    await expect(page.locator(".checklist-count")).toHaveText("2 of 4 done. This list goes away once you're set.");
    await expect(item(page, /Add at least 3 films/).locator(".btn.primary")).toHaveText("Add films");
    await expect(filled(page)).toHaveCount(1);

    // A member who joins never sees it.
    const member = await person("Hal H.", "sc-member");
    await db.insert(schema.memberships).values({ clubId, userId: member, role: "member", joinedAt: new Date() });
    const other = await browser.newContext();
    const theirs = await other.newPage();
    await signInAsUser(theirs, member);
    await theirs.goto(`/clubs/${clubId}`);
    await expect(theirs.locator(".getting-started")).toHaveCount(0);
    await other.close();

    // Films: done at three of the owner's own.
    const films = await db.select({ id: schema.films.id }).from(schema.films).limit(3);
    await db.insert(schema.watchlistItems).values(films.slice(0, 2).map((f) => ({ userId: owner, filmId: f.id })));
    await page.reload();
    await expect(item(page, /Add at least 3 films/)).toContainText("2 of 3 added.");
    await expect(item(page, /Add at least 3 films/)).not.toHaveClass(/done/);
    await db.insert(schema.watchlistItems).values({ userId: owner, filmId: films[2].id });
    await page.reload();
    await expect(item(page, /Add at least 3 films/)).toHaveClass(/done/);

    // Check how it runs: Looks good, then it's all done and gone.
    await expect(item(page, /Check how the club runs/).locator(".btn.primary")).toHaveText("Looks good");
    await item(page, /Check how the club runs/).getByRole("button", { name: "Looks good" }).click();
    await expect(page.locator(".getting-started")).toHaveCount(0);
    expect((await clubRow(clubId)).settings).toMatchObject({ gettingStarted: { checked: true, hidden: false } });
  });

  test("saving how the club runs ticks Check how it runs; Hide this list hides it", async ({ page }) => {
    const owner = await person("Ivy I.", "sc-hide");
    const clubId = await startClub(page, owner, "Hide Club");
    // Any group saved on How this club runs (u6) counts.
    await page.goto(`/clubs/${clubId}/members/settings?edit=voting`);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page).toHaveURL(/saved=voting/);
    await page.goto(`/clubs/${clubId}`);
    await expect(item(page, /Check how the club runs/)).toHaveClass(/done/);

    await page.getByRole("button", { name: "Hide this list" }).click();
    await expect(page.locator(".getting-started")).toHaveCount(0);
    expect((await clubRow(clubId)).settings).toMatchObject({ gettingStarted: { checked: true, hidden: true } });
  });

  test("a club from before u4 has no list", async ({ page }) => {
    const owner = await person("Jo J.", "sc-old");
    const clubId = id();
    await db.insert(schema.clubs).values({ id: clubId, name: "Old Club", cadence: "weekly", defaultDay: 6, defaultTime: "20:00", timezone: "America/New_York", mode: "in_person" });
    await db.insert(schema.memberships).values({ clubId, userId: owner, role: "owner", joinedAt: at });
    await signInAsUser(page, owner);
    await page.goto(`/clubs/${clubId}`);
    await expect(page.locator(".getting-started")).toHaveCount(0);
  });
});

test.describe("Invite people", () => {
  test("create a link, copy it, cancel it; the seat count follows; the phone tab bar is there", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const owner = await person("Kim K.", "sc-invite");
    const clubId = await startClub(page, owner, "Invite Club");
    await page.goto(`/clubs/${clubId}/members`);
    await page.getByRole("link", { name: "+ Invite", exact: true }).click();
    await expect(page).toHaveURL(`/clubs/${clubId}/members/invite`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Who's coming to Invite Club?");
    await expect(page.locator(".seats-left")).toHaveText("Each person gets their own link. 5 seats left.");
    await expect(page.getByRole("link", { name: "Back to Invite Club" })).toHaveAttribute("href", `/clubs/${clubId}`);

    await page.getByLabel("Their name").fill("Lou");
    await page.getByRole("button", { name: "Create invite link" }).click();
    const fresh = page.locator(".fresh-invite");
    await expect(fresh.getByRole("heading")).toHaveText("Link for Lou is ready");
    await expect(fresh).toContainText("Only Lou should use this link. It works once.");
    const link = await page.getByLabel("Invite link for Lou").inputValue();
    expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{22}$/);
    await fresh.getByRole("button", { name: "Copy link" }).click();
    await expect(fresh.getByRole("button", { name: "Link copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
    await expect(page.locator(".seats-left")).toHaveText("Each person gets their own link. 4 seats left.");
    // Each waiting invite: who, whether they've started, New link, Cancel (u6).
    await expect(page.locator(".waiting-list li")).toHaveCount(1);
    await expect(page.locator(".waiting-list li")).toContainText("LouNot started yet");
    await expect(page.locator(".waiting-list li").getByRole("button", { name: "New link for Lou" })).toBeVisible();

    await page.getByRole("button", { name: "Cancel Lou's invite" }).click();
    await expect(page).toHaveURL(`/clubs/${clubId}/members/invite`);
    await expect(page.locator(".waiting-list")).toHaveCount(0);
    await expect(page.locator(".seats-left")).toHaveText("Each person gets their own link. 5 seats left.");
    const [revoked] = await db.select().from(schema.invites).where(eq(schema.invites.clubId, clubId));
    expect(revoked.revokedAt).not.toBeNull();

    await page.setViewportSize({ width: 375, height: 800 });
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  });

  test("a plain member is sent back to Members", async ({ page }) => {
    const owner = await person("Max M.", "sc-inv-owner");
    const clubId = await startClub(page, owner, "Members Only Club");
    const member = await person("Ned N.", "sc-inv-member");
    await db.insert(schema.memberships).values({ clubId, userId: member, role: "member", joinedAt: new Date() });
    await signInAsUser(page, member);
    await page.goto(`/clubs/${clubId}/members/invite`);
    await expect(page).toHaveURL(`/clubs/${clubId}/members`);
  });
});
