import { neon } from "@neondatabase/serverless";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../db/schema";
import { runWeeklyLoop } from "../app/weeklyLoop";
import { LEGAL } from "../lib/legal";
import { expect, test } from "./fixtures";
import { signInAsUser } from "./session";

// Late confirmation (CLAUDE.md "Night deadlines", ruled 2026-11-21): "Yes,
// we watched it" on an unconfirmed night, for 7 days after it became
// unconfirmed, while no later night has finished. A late "No" is refused.
// Nights are made unconfirmed by the hourly job itself (runWeeklyLoop with a
// chosen now, scoped by clubIds). A refused answer is reached the way a real
// one would be: a tab left open on a button the night has moved past.

const db = drizzle(neon(process.env.E2E_DATABASE_URL!), { schema });
const id = () => crypto.randomUUID();
const H = 3600_000;
const NOW = new Date();
const hours = (n: number) => new Date(NOW.getTime() + n * H);
const at = new Date(Date.UTC(2026, 0, 1));

// Ana picked the locked night (Arrival); Ana and Ben said yes. Ben and Cal
// picked earlier watched nights, so Ben is next whichever way Ana's counts
// (both unconfirmed and watched consume her turn).
async function club(name: string, scheduledAt: Date, unconfirmAt: Date) {
  const clubId = id();
  await db.insert(schema.clubs).values({
    id: clubId,
    name,
    cadence: "weekly",
    defaultDay: 6,
    defaultTime: "20:00",
    timezone: "America/New_York",
    mode: "in_person",
  });
  const users = { ana: id(), ben: id(), cal: id() };
  const members = { ana: id(), ben: id(), cal: id() };
  for (const [i, key] of (["ana", "ben", "cal"] as const).entries()) {
    await db.insert(schema.users).values({
      id: users[key],
      email: `${key}.${clubId.slice(0, 8)}@example.com`,
      displayName: `${key[0].toUpperCase()}${key.slice(1)} Q.`,
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
  const films = await db.select().from(schema.films).where(inArray(schema.films.title, ["Arrival", "Thief", "Hereditary"]));
  const film = (title: string) => films.find((f) => f.title === title)!;
  await db.insert(schema.nights).values([
    { clubId, scheduledAt: new Date(scheduledAt.getTime() - 20 * 24 * H), pickerMembershipId: members.ben, state: "watched", winningFilmId: film("Hereditary").id },
    { clubId, scheduledAt: new Date(scheduledAt.getTime() - 13 * 24 * H), pickerMembershipId: members.cal, state: "watched", winningFilmId: film("Thief").id },
  ]);
  const [night] = await db
    .insert(schema.nights)
    .values({
      clubId,
      scheduledAt,
      pickerMembershipId: members.ana,
      state: "locked",
      winningFilmId: film("Arrival").id,
      lockedAt: new Date(scheduledAt.getTime() - 24 * H),
      lockAt: new Date(scheduledAt.getTime() - 24 * H),
      unconfirmAt,
    })
    .returning();
  await db.insert(schema.nominations).values({ nightId: night.id, filmId: film("Arrival").id, membershipId: members.ana, position: 1 });
  await db.insert(schema.rsvps).values([
    { nightId: night.id, membershipId: members.ana, status: "yes" },
    { nightId: night.id, membershipId: members.ben, status: "yes" },
  ]);
  return { clubId, users, members, nightId: night.id, film };
}

const nightRow = async (nightId: string) => (await db.select().from(schema.nights).where(eq(schema.nights.id, nightId)))[0];
const draftPicker = async (clubId: string) =>
  (await db.select().from(schema.nights).where(and(eq(schema.nights.clubId, clubId), eq(schema.nights.state, "draft"))))[0]
    ?.pickerMembershipId;
const YES = { name: "Yes, we watched it" } as const;

test.describe("late confirmation", () => {
  test("only Yes; Yes makes it watched, opens ratings, shows in History and the badge; unconfirmed_at kept; the rotation unchanged", async ({
    page,
  }) => {
    const c = await club("Late Yes Club", hours(-72), hours(-1));
    expect(await runWeeklyLoop(db, NOW, { reminders: false, clubIds: [c.clubId] })).toMatchObject({ unconfirmed: 1 });
    const unconfirmedAt = (await nightRow(c.nightId)).unconfirmedAt!;

    await signInAsUser(page, c.users.ana);
    await page.goto("/");
    await expect(page.getByText("Did you watch Arrival after all?")).toBeVisible();

    await page.goto(`/clubs/${c.clubId}`);
    const late = page.locator("section.late-confirm");
    await expect(late.getByRole("heading")).toHaveText("Did you watch Arrival after all?");
    await expect(late.getByRole("button")).toHaveText(["Yes, we watched it"]);
    await expect(page.getByRole("button", { name: "We didn't meet" })).toHaveCount(0);
    // The rotation, before: the next draft is Ben's.
    expect(await draftPicker(c.clubId)).toBe(c.members.ben);

    await late.getByRole("button", YES).click();
    await expect(page.locator("section.late-confirm")).toHaveCount(0);
    const night = await nightRow(c.nightId);
    expect(night.state).toBe("watched");
    expect(night.confirmedBy).toBe(c.members.ana);
    expect(night.unconfirmedAt?.getTime()).toBe(unconfirmedAt.getTime());

    // Ratings open, the normal way: Ana said yes.
    await expect(page.getByRole("heading", { name: "Rate Arrival" })).toBeVisible();

    // The rotation, after: unchanged. A fresh draft still goes to Ben.
    expect(await draftPicker(c.clubId)).toBe(c.members.ben);
    await db.delete(schema.nights).where(and(eq(schema.nights.clubId, c.clubId), eq(schema.nights.state, "draft")));
    await page.reload();
    expect(await draftPicker(c.clubId)).toBe(c.members.ben);

    // History: watched, with who came.
    await page.goto(`/clubs/${c.clubId}/history`);
    const item = page.locator("li.history-night", { hasText: "Arrival" }).first();
    await expect(item).toContainText("Came:");
    await expect(item).not.toContainText("Nobody confirmed");

    // The "club watched this" badge.
    await page.goto(`/watchlist?${new URLSearchParams({ q: "Arrival" })}`);
    await expect(page.locator(".watched-badge").first()).toBeVisible();
  });

  test("a late No is refused: a tab left on the prompt changes nothing", async ({ page }) => {
    const c = await club("Late No Club", hours(-72), hours(-1));
    await signInAsUser(page, c.users.ben);
    await page.goto(`/clubs/${c.clubId}`);
    const no = page.getByRole("button", { name: "We didn't meet" });
    await expect(no).toBeVisible();

    // The job logs it unconfirmed while the tab sits there.
    expect(await runWeeklyLoop(db, NOW, { reminders: false, clubIds: [c.clubId] })).toMatchObject({ unconfirmed: 1 });
    await no.click();
    await expect(page.locator("section.late-confirm")).toBeVisible();
    const night = await nightRow(c.nightId);
    expect(night.state).toBe("unconfirmed");
    expect(night.confirmedBy).toBeNull();
  });

  test("past 7 days: no prompt, and a Yes from a tab left open is refused", async ({ page }) => {
    // Logged unconfirmed 6 days ago: still open.
    const c = await club("Late Expired Club", hours(-24 * 10), hours(-24 * 7));
    expect(await runWeeklyLoop(db, hours(-24 * 6), { reminders: false, clubIds: [c.clubId] })).toMatchObject({ unconfirmed: 1 });
    await signInAsUser(page, c.users.ben);
    await page.goto(`/clubs/${c.clubId}`);
    const yes = page.locator("section.late-confirm").getByRole("button", YES);
    await expect(yes).toBeVisible();

    // Two more days pass (as if it had been logged 8 days ago).
    await db.update(schema.nights).set({ unconfirmedAt: hours(-24 * 8) }).where(eq(schema.nights.id, c.nightId));
    await yes.click();
    await expect(page.locator("section.late-confirm")).toHaveCount(0);
    expect((await nightRow(c.nightId)).state).toBe("unconfirmed");
    await page.goto("/");
    await expect(page.getByText("Did you watch Arrival after all?")).toHaveCount(0);
  });

  test("once a later night has finished, no prompt", async ({ page }) => {
    const c = await club("Late Superseded Club", hours(-72), hours(-1));
    expect(await runWeeklyLoop(db, NOW, { reminders: false, clubIds: [c.clubId] })).toMatchObject({ unconfirmed: 1 });
    await db.insert(schema.nights).values({
      clubId: c.clubId,
      scheduledAt: hours(-2),
      pickerMembershipId: c.members.ben,
      state: "cancelled",
    });
    await signInAsUser(page, c.users.ben);
    await page.goto(`/clubs/${c.clubId}`);
    await expect(page.locator("section.late-confirm")).toHaveCount(0);
    expect((await nightRow(c.nightId)).state).toBe("unconfirmed");
  });
});
