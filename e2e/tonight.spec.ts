import type { Page } from "@playwright/test";
import { neon } from "@neondatabase/serverless";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../db/schema";
import { LEGAL } from "../lib/legal";
import { expect, test } from "./fixtures";
import { setScore } from "./rating";
import { signInAsUser } from "./session";

// The Tonight redesign (ruled 2026-11-25): the week bar's step for each
// state, one filled button per page, voting by tapping a poster, vote
// counts hidden unless the club shows them, and "I was there" (ruled
// 2026-11-24) from offer to reveal. Each test builds its own club.

const db = drizzle(neon(process.env.E2E_DATABASE_URL!), { schema });
const id = () => crypto.randomUUID();
const H = 3600_000;
const at = new Date(Date.UTC(2026, 0, 1));
const hours = (h: number) => new Date(Date.now() + h * H);
type Key = "ana" | "ben" | "cal" | "dee";

async function club(
  name: string,
  o: { settings?: Record<string, unknown>; paused?: boolean; cadence?: "weekly" | "ad_hoc" } = {},
) {
  const clubId = id();
  await db.insert(schema.clubs).values({
    id: clubId,
    name,
    cadence: o.cadence ?? "weekly",
    defaultDay: 6,
    defaultTime: "20:00",
    timezone: "America/New_York",
    mode: "in_person",
    settings: o.settings ?? {},
    pausedAt: o.paused ? hours(-24) : null,
  });
  const users = {} as Record<Key, string>;
  const members = {} as Record<Key, string>;
  for (const [i, key] of (["ana", "ben", "cal", "dee"] as const).entries()) {
    users[key] = id();
    members[key] = id();
    await db.insert(schema.users).values({
      id: users[key],
      email: `${key}.tonight.${clubId.slice(0, 8)}@example.com`,
      displayName: `${key[0].toUpperCase()}${key.slice(1)} T.`,
      ageBracket: "18_plus",
      ageAttestedAt: at,
    });
    await db.insert(schema.consentEvents).values(
      (["terms", "privacy"] as const).map((document) => ({
        userId: users[key],
        document,
        version: LEGAL[document].version,
        acceptedAt: at,
        method: "signup" as const,
      })),
    );
    await db.insert(schema.memberships).values({
      id: members[key],
      clubId,
      userId: users[key],
      role: key === "ana" ? "owner" : "member",
      joinedAt: new Date(Date.UTC(2026, 0, i + 1)),
    });
  }
  return { clubId, users, members };
}
type Club = Awaited<ReturnType<typeof club>>;

async function filmIds(...titles: string[]) {
  const rows = await db.select().from(schema.films).where(inArray(schema.films.title, titles));
  return titles.map((t) => rows.find((r) => r.title === t)!.id);
}

async function night(c: Club, values: Partial<typeof schema.nights.$inferInsert>) {
  const [n] = await db
    .insert(schema.nights)
    .values({ clubId: c.clubId, pickerMembershipId: c.members.ben, state: "draft", scheduledAt: hours(48), ...values })
    .returning();
  return n.id;
}

async function openNight(c: Club) {
  const nightId = await night(c, { state: "open", lockAt: hours(20) });
  const [arrival, thief] = await filmIds("Arrival", "Thief");
  await db.insert(schema.nominations).values([
    { nightId, filmId: arrival, membershipId: c.members.ben, position: 1 },
    { nightId, filmId: thief, membershipId: c.members.ben, position: 2 },
  ]);
  return nightId;
}

async function open(page: Page, c: Club, who: Key) {
  await signInAsUser(page, c.users[who]);
  await page.goto(`/clubs/${c.clubId}`);
}

const currentStep = (page: Page) => page.locator('.weekbar li[aria-current="step"] .weekbar-label');
const filledButtons = (page: Page) => page.locator("main .btn.primary:visible");

test.describe("Tonight", () => {
  test("the week bar names the current step in each state, with one filled button on the page", async ({ page }) => {
    const [arrival] = await filmIds("Arrival");

    // A draft: Nominate. The picker's card has the one filled button.
    const drafting = await club("Tonight Draft Club");
    await db.insert(schema.watchlistItems).values({ userId: drafting.users.ben, filmId: arrival });
    await night(drafting, { state: "draft" });
    await open(page, drafting, "ben");
    await expect(currentStep(page)).toHaveText("Nominate");
    await expect(page.locator(".weekbar li.done")).toHaveCount(0);
    await expect(filledButtons(page)).toHaveCount(1);
    await expect(page.locator(".card.now")).toContainText("Your turn to nominate");

    // Open: Vote, one step done.
    const voting = await club("Tonight Vote Club");
    await openNight(voting);
    await open(page, voting, "cal");
    await expect(currentStep(page)).toHaveText("Vote");
    await expect(page.locator(".weekbar li.done")).toHaveCount(1);
    await expect(filledButtons(page)).toHaveCount(0);

    // Locked, before the night: Locked, with the film as the hero.
    const locked = await club("Tonight Locked Club");
    await night(locked, { state: "locked", scheduledAt: hours(50), lockedAt: hours(-1), unconfirmAt: hours(120), winningFilmId: arrival });
    await open(page, locked, "cal");
    await expect(currentStep(page)).toHaveText("Locked");
    await expect(page.locator(".locked-hero")).toContainText("Starts in 2 days");
    await expect(page.locator(".locked-hero")).toContainText("Nobody voted");

    // Locked and started, before the prompt (morning after): Watch.
    const watching = await club("Tonight Watching Club");
    await night(watching, { state: "locked", scheduledAt: hours(-1), lockedAt: hours(-30), unconfirmAt: hours(60), winningFilmId: arrival });
    await open(page, watching, "cal");
    await expect(currentStep(page)).toHaveText("Watch");
    await expect(page.locator(".locked-hero")).toContainText("Started");

    // "Did you watch it?" due: Watch, and its Yes is the one filled button.
    const confirming = await club("Tonight Confirm Club", { settings: { confirmAt: "same_night" } });
    await night(confirming, { state: "locked", scheduledAt: hours(-3), lockedAt: hours(-30), unconfirmAt: hours(60), winningFilmId: arrival });
    await open(page, confirming, "cal");
    await expect(currentStep(page)).toHaveText("Watch");
    await expect(filledButtons(page)).toHaveCount(1);
    await expect(filledButtons(page)).toHaveText("Yes");

    // Watched, someone who came still to rate: Rate, four steps done.
    const rating = await club("Tonight Rate Club");
    const watchedId = await night(rating, { state: "watched", scheduledAt: hours(-20), confirmedAt: hours(-6), winningFilmId: arrival });
    await db.insert(schema.rsvps).values({ nightId: watchedId, membershipId: rating.members.cal, status: "yes" });
    await open(page, rating, "cal");
    await expect(currentStep(page)).toHaveText("Rate");
    await expect(page.locator(".weekbar li.done")).toHaveCount(4);
    await expect(page.getByRole("heading", { name: "Rate Arrival" })).toBeVisible();
    await expect(filledButtons(page)).toHaveCount(1);

    // A paused club with nothing in flight: no bar, the message as the card.
    const paused = await club("Tonight Paused Club", { paused: true });
    await open(page, paused, "cal");
    await expect(page.locator(".weekbar")).toHaveCount(0);
    await expect(page.locator(".card.now")).toContainText("This club is paused");

    // A cancelled night and nothing else (ad hoc, so nothing drafts): no bar.
    const cancelled = await club("Tonight Cancelled Club", { cadence: "ad_hoc" });
    await night(cancelled, { state: "cancelled", scheduledAt: hours(-50), confirmedAt: hours(-40) });
    await open(page, cancelled, "cal");
    await expect(page.locator(".weekbar")).toHaveCount(0);
  });

  test("voting: tap a poster; your choice is pressed with \"Your vote ✓\"; you can move it", async ({ page }) => {
    const c = await club("Tonight Poster Club");
    await openNight(c);
    await open(page, c, "cal");
    const arrival = page.locator("li.nominee", { hasText: "Arrival" });
    const thief = page.locator("li.nominee", { hasText: "Thief" });
    await expect(page.getByText("Ben T. picked these. Tap a poster to vote.")).toBeVisible();
    await expect(page.getByText("You can change your vote until voting closes.")).toBeVisible();
    await expect(page.getByText("If nobody votes, Ben T.'s first choice wins.")).toBeVisible();

    await arrival.getByRole("button").click();
    await expect(arrival.getByRole("button")).toHaveAttribute("aria-pressed", "true");
    await expect(arrival.locator(".vote-badge")).toHaveText("Your vote ✓");
    await expect(thief.getByRole("button")).toHaveAttribute("aria-pressed", "false");
    await expect(thief).toContainText("Vote");

    // Moving it: one vote, now on Thief.
    await thief.getByRole("button").click();
    await expect(thief.locator(".vote-badge")).toHaveText("Your vote ✓");
    await expect(arrival.locator(".vote-badge")).toHaveCount(0);
    await expect(page.getByText("Your vote ✓")).toHaveCount(1);
  });

  test("vote counts: hidden while voting by default; shown once the owner turns them on", async ({ page }) => {
    const c = await club("Tonight Counts Club");
    await openNight(c);
    await open(page, c, "cal");
    await page.locator("li.nominee", { hasText: "Arrival" }).getByRole("button").click();
    await expect(page.locator(".vote-badge")).toHaveText("Your vote ✓");
    await expect(page.locator(".vote-count")).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText("1 vote");

    // Every member sees the setting; only the owner or an admin changes it.
    await page.goto(`/clubs/${c.clubId}/members`);
    await expect(page.locator(".club-settings-values")).toContainText("Hidden until voting closes");

    await open(page, c, "ana");
    await page.goto(`/clubs/${c.clubId}/members`);
    const counts = page.getByLabel("Show vote counts while voting is open");
    await expect(counts).not.toBeChecked();
    await counts.check();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page).toHaveURL(/saved=settings/);
    await expect(page.getByLabel("Show vote counts while voting is open")).toBeChecked();
    const [row] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, c.clubId));
    expect(row.settings).toMatchObject({ showVoteCounts: true });

    // Display only: it applies at once, to the vote already under way.
    await page.goto(`/clubs/${c.clubId}`);
    await expect(page.locator("li.nominee", { hasText: "Arrival" }).locator(".vote-count")).toHaveText("1 vote");
    await expect(page.locator("li.nominee", { hasText: "Thief" }).locator(".vote-count")).toHaveText("0 votes");
  });

  test("I was there: offered only when eligible, records a yes, holds the reveal until they rate, then is gone", async ({
    page,
    browser,
  }) => {
    const c = await club("Tonight There Club");
    const [arrival] = await filmIds("Arrival");
    const nightId = await night(c, { state: "watched", scheduledAt: hours(-20), confirmedAt: hours(-6), winningFilmId: arrival });
    // Cal said yes and Dee said no; Ana and Ben never answered.
    await db.insert(schema.rsvps).values([
      { nightId, membershipId: c.members.cal, status: "yes" },
      { nightId, membershipId: c.members.dee, status: "no" },
    ]);
    const rsvpOf = async (who: Key) =>
      (
        await db
          .select()
          .from(schema.rsvps)
          .where(and(eq(schema.rsvps.nightId, nightId), eq(schema.rsvps.membershipId, c.members[who])))
      )[0]?.status ?? null;

    // Dee said no: nothing to do. Cal said yes: rates.
    await open(page, c, "dee");
    await expect(page.getByRole("button", { name: "I was there" })).toHaveCount(0);
    await open(page, c, "cal");
    await expect(page.getByRole("button", { name: "I was there" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Rate Arrival" })).toBeVisible();

    // Ben never answered: offered, as the do-this-now card.
    await open(page, c, "ben");
    await expect(page.getByRole("heading", { name: "Were you there for Arrival?" })).toBeVisible();
    await expect(page.getByText("Not there? Nothing to do.")).toBeVisible();
    await expect(page.locator(".card.now")).toContainText("Were you there for Arrival?");
    await page.getByRole("button", { name: "I was there" }).click();
    await expect(page.getByRole("heading", { name: "Rate Arrival" })).toBeVisible();
    expect(await rsvpOf("ben")).toBe("yes");

    // Ana opens the offer in a tab she'll leave stale.
    const anaContext = await browser.newContext();
    const stale = await anaContext.newPage();
    await signInAsUser(stale, c.users.ana);
    await stale.goto(`/clubs/${c.clubId}`);
    await expect(stale.getByRole("button", { name: "I was there" })).toBeVisible();

    // Cal rates: still hidden, Ben is waited on like any yes.
    await open(page, c, "cal");
    await setScore(page, "Quality", 8);
    await setScore(page, "Fun", 7);
    await page.getByRole("button", { name: "Submit rating" }).click();
    await expect(page.getByText("1/2 ratings in")).toBeVisible();

    // Ben rates: revealed, and History counts him as having come.
    await open(page, c, "ben");
    await setScore(page, "Quality", 6);
    await setScore(page, "Fun", 9);
    await page.getByRole("button", { name: "Submit rating" }).click();
    await expect(page.locator("li.card").filter({ hasText: "quality 8.0" })).toBeVisible();
    await page.goto(`/clubs/${c.clubId}/history`);
    await expect(page.locator("li.history-night", { hasText: "Arrival" })).toContainText("Ben T.");

    // After the reveal it's gone for Ana, and her stale tab changes nothing.
    await open(page, c, "ana");
    await expect(page.getByRole("button", { name: "I was there" })).toHaveCount(0);
    await stale.getByRole("button", { name: "I was there" }).click();
    await expect(stale.getByRole("button", { name: "I was there" })).toHaveCount(0);
    expect(await rsvpOf("ana")).toBeNull();
    await open(page, c, "cal");
    await expect(page.locator("li.card").filter({ hasText: "quality 6.0" })).toBeVisible();
    await anaContext.close();
  });

  test("RSVP: \"Coming Saturday?\" under the action, the answer pressed; gone once the night starts", async ({ page }) => {
    const c = await club("Tonight RSVP Club");
    await openNight(c);
    await open(page, c, "cal");
    const rsvp = page.locator(".rsvp-card");
    await expect(rsvp.getByRole("heading", { name: /^Coming \w+\?$/ })).toBeVisible();
    // Below the do-this-now card.
    const order = await page.evaluate(() => {
      const now = document.querySelector(".card.now")!;
      const card = document.querySelector(".rsvp-card")!;
      return Boolean(now.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(order).toBe(true);
    await rsvp.getByRole("button", { name: "Going", exact: true }).click();
    await expect(rsvp.getByRole("button", { name: "Going", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(rsvp.getByRole("button", { name: "Not going", exact: true })).toHaveAttribute("aria-pressed", "false");
    // Outlined, never filled: the do-this-now card has the page's only fill.
    await expect(rsvp.locator(".btn.primary")).toHaveCount(0);
  });

  test("the side column names who's picking and what was watched recently", async ({ page }) => {
    const c = await club("Tonight Side Club");
    const [thief] = await filmIds("Thief");
    await night(c, { state: "watched", scheduledAt: hours(-24 * 7), confirmedAt: hours(-24 * 6), winningFilmId: thief, pickerMembershipId: c.members.ana });
    await night(c, { state: "draft" });
    await open(page, c, "cal");
    const rail = page.getByRole("complementary", { name: "Club context" });
    await expect(rail.locator(".whose-turn")).toHaveText("Ben T.");
    await expect(rail).toContainText("Next turn");
    await expect(rail.locator(".recently-watched")).toContainText("Thief");
    await expect(rail.getByRole("link", { name: "All history →" })).toBeVisible();

    // Phones: the same, collapsed below the cards.
    await page.setViewportSize({ width: 375, height: 800 });
    const glance = page.locator("details.glance");
    await expect(glance).toBeVisible();
    await glance.locator("summary").click();
    await expect(glance.locator(".whose-turn")).toHaveText("Ben T.");
  });
});
