import { neon } from "@neondatabase/serverless";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../db/schema";
import { nightName } from "../lib/clubStatus";
import { LEGAL } from "../lib/legal";
import { expect, test } from "./fixtures";
import { signInAsUser } from "./session";

// RSVP goes once the night has started (ruled 2026-11-24); lock is
// unchanged, so a locked night that hasn't started still takes one. And
// "Did you watch X?" names the night it asks about, never a hard-coded
// "Sunday morning".

const db = drizzle(neon(process.env.E2E_DATABASE_URL!), { schema });
const id = () => crypto.randomUUID();
const H = 3600_000;
const TZ = "America/New_York";
const at = new Date(Date.UTC(2026, 0, 1));

async function lockedClub(name: string, scheduledAt: Date, settings: Record<string, unknown> = {}) {
  const clubId = id();
  await db.insert(schema.clubs).values({
    id: clubId,
    name,
    cadence: "weekly",
    defaultDay: 6,
    defaultTime: "20:00",
    timezone: TZ,
    mode: "in_person",
    settings,
  });
  const userId = id();
  const membershipId = id();
  await db.insert(schema.users).values({
    id: userId,
    email: `rsvp.${clubId.slice(0, 8)}@example.com`,
    displayName: "Rae R.",
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
  await db.insert(schema.memberships).values({ id: membershipId, clubId, userId, role: "owner", joinedAt: at });
  const [film] = await db.select().from(schema.films).where(inArray(schema.films.title, ["Thief"]));
  await db.insert(schema.nights).values({
    clubId,
    pickerMembershipId: membershipId,
    state: "locked",
    scheduledAt,
    lockedAt: new Date(scheduledAt.getTime() - 24 * H),
    unconfirmAt: new Date(Date.now() + 72 * H),
    winningFilmId: film.id,
  });
  return { clubId, userId };
}

test.describe("RSVP once the night has started", () => {
  test("a locked night that hasn't started still takes an RSVP", async ({ page }) => {
    const c = await lockedClub("RSVP Before Club", new Date(Date.now() + 30 * H));
    await signInAsUser(page, c.userId);
    await page.goto(`/clubs/${c.clubId}`);
    await expect(page.getByRole("heading", { name: /^Coming \w+\?$/ })).toBeVisible();
    await page.getByRole("button", { name: "Going", exact: true }).click();
    await expect(page.getByRole("button", { name: "Going", exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  test("once it has started, there's no RSVP; the locked display stays", async ({ page }) => {
    // Two hours in: locked, not yet confirmable (morning after, the default).
    const c = await lockedClub("RSVP Started Club", new Date(Date.now() - 2 * H));
    await signInAsUser(page, c.userId);
    await page.goto(`/clubs/${c.clubId}`);
    await expect(page.getByText("Locked in")).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Coming \w+\?$/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Going", exact: true })).toHaveCount(0);
  });

  test("Did you watch it names the night, with no RSVP beside it", async ({ page }) => {
    const scheduledAt = new Date(Date.now() - 40 * H);
    const c = await lockedClub("RSVP Confirm Club", scheduledAt, { confirmAt: "same_night" });
    await signInAsUser(page, c.userId);
    await page.goto(`/clubs/${c.clubId}`);
    await expect(page.getByRole("heading", { name: "Did you watch Thief?" })).toBeVisible();
    await expect(page.locator(".confirm-night")).toHaveText(nightName(scheduledAt, TZ, new Date()));
    await expect(page.getByRole("button", { name: "Going", exact: true })).toHaveCount(0);
  });
});
