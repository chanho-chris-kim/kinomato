import { neon } from "@neondatabase/serverless";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../db/schema";
import { DRAFTS_PER_RUN, runWeeklyLoop } from "../app/weeklyLoop";
import { getDraftToCreate } from "../lib/clubStatus";
import { LEGAL } from "../lib/legal";
import { getNextOccurrence } from "../lib/schedule";
import { expect, test } from "./fixtures";
import { signInAsUser } from "./session";

// The hourly job drafts each week's night (ruled 2026-11-22): the same
// creation as Tonight's lazy one (app/clubs/[clubId]/draftNightCore.ts),
// for clubs nobody visits. Called directly with the Worker's driver and a
// chosen now, scoped by clubIds, the way e2e/weekly-loop.spec.ts does.

const db = drizzle(neon(process.env.E2E_DATABASE_URL!), { schema });
const id = () => crypto.randomUUID();
const H = 3600_000;
const NOW = new Date();
const at = new Date(Date.UTC(2026, 0, 1));
const TZ = "America/New_York";
const zero = { locked: 0, unconfirmed: 0, passed: 0, drafted: 0, reminded: 0, remind_failed: 0, failed: 0 };

// Ana, Ben and Cal, consent given, joined in that order.
async function club(
  name: string,
  o: {
    cadence?: "weekly" | "ad_hoc";
    paused?: boolean;
    settings?: Record<string, unknown>;
    defaultDay?: number;
    defaultTime?: string;
  } = {},
) {
  const clubId = id();
  await db.insert(schema.clubs).values({
    id: clubId,
    name,
    cadence: o.cadence ?? "weekly",
    defaultDay: o.defaultDay ?? 6,
    defaultTime: o.defaultTime ?? "20:00",
    timezone: TZ,
    mode: "in_person",
    settings: o.settings ?? {},
    pausedAt: o.paused ? new Date(NOW.getTime() - 48 * H) : null,
  });
  const users = { ana: id(), ben: id(), cal: id() };
  const members = { ana: id(), ben: id(), cal: id() };
  for (const [i, key] of (["ana", "ben", "cal"] as const).entries()) {
    await db.insert(schema.users).values({
      id: users[key],
      email: `${key}.${clubId.slice(0, 8)}@example.com`,
      displayName: `${key[0].toUpperCase()}${key.slice(1)} J.`,
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

const draftsOf = (clubId: string) =>
  db.select().from(schema.nights).where(and(eq(schema.nights.clubId, clubId), eq(schema.nights.state, "draft")));
const membershipOf = async (membershipId: string) =>
  (await db.select().from(schema.memberships).where(eq(schema.memberships.id, membershipId)))[0];

// What the page's own rule would draft for this club right now.
async function expectedDraft(c: Club, now: Date) {
  const [clubRow] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, c.clubId));
  return getDraftToCreate({
    club: clubRow,
    memberships: await db.select().from(schema.memberships).where(eq(schema.memberships.clubId, c.clubId)),
    nights: await db.select().from(schema.nights).where(eq(schema.nights.clubId, c.clubId)),
    now,
  });
}

test.describe("the job drafts each week's night", () => {
  test("a club with nothing in flight gets its draft, for the right picker and date; a second run creates nothing", async () => {
    const c = await club("Job Draft Club");
    const expected = await expectedDraft(c, NOW);
    expect(expected?.pickerMembershipId).toBe(c.members.ana);

    expect(await runWeeklyLoop(db, NOW, { reminders: false, clubIds: [c.clubId] })).toEqual({ ...zero, drafted: 1 });
    const [draft] = await draftsOf(c.clubId);
    expect(draft.pickerMembershipId).toBe(c.members.ana);
    expect(draft.scheduledAt.getTime()).toBe(expected!.scheduledAt.getTime());
    const [clubRow] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, c.clubId));
    expect(draft.scheduledAt.getTime()).toBe(getNextOccurrence(clubRow, NOW, clubRow.createdAt)!.getTime());

    expect(await runWeeklyLoop(db, NOW, { reminders: false, clubIds: [c.clubId] })).toEqual(zero);
    expect(await draftsOf(c.clubId)).toHaveLength(1);
  });

  test("a paused club and an ad hoc club get none", async () => {
    const paused = await club("Job Paused Club", { paused: true });
    const adHoc = await club("Job Ad Hoc Club", { cadence: "ad_hoc" });
    expect(await runWeeklyLoop(db, NOW, { reminders: false, clubIds: [paused.clubId, adHoc.clubId] })).toEqual(zero);
    expect(await draftsOf(paused.clubId)).toEqual([]);
    expect(await draftsOf(adHoc.clubId)).toEqual([]);
  });

  test("a page load and the job racing leave exactly one draft", async ({ page }) => {
    const c = await club("Job Race Club");
    await signInAsUser(page, c.users.ben);
    const [job] = await Promise.all([runWeeklyLoop(db, NOW, { reminders: false, clubIds: [c.clubId] }), page.goto(`/clubs/${c.clubId}`)]);
    expect(job.failed).toBe(0);
    expect(await draftsOf(c.clubId)).toHaveLength(1);
    await page.reload();
    await expect(page.locator("main")).toContainText("Ana J.");
  });

  test("a night unconfirmed in the same run gets its successor, for the next picker", async () => {
    const c = await club("Job Successor Club");
    const films = await db.select().from(schema.films).where(inArray(schema.films.title, ["Arrival", "Thief"]));
    // Ben and Cal picked before; Ana's locked night, nobody answered.
    await db.insert(schema.nights).values([
      { clubId: c.clubId, scheduledAt: new Date(NOW.getTime() - 20 * 24 * H), pickerMembershipId: c.members.ben, state: "watched", winningFilmId: films[0].id },
      { clubId: c.clubId, scheduledAt: new Date(NOW.getTime() - 13 * 24 * H), pickerMembershipId: c.members.cal, state: "watched", winningFilmId: films[1].id },
    ]);
    const [locked] = await db
      .insert(schema.nights)
      .values({
        clubId: c.clubId,
        scheduledAt: new Date(NOW.getTime() - 72 * H),
        pickerMembershipId: c.members.ana,
        state: "locked",
        winningFilmId: films[0].id,
        lockedAt: new Date(NOW.getTime() - 96 * H),
        unconfirmAt: new Date(NOW.getTime() - H),
      })
      .returning();

    expect(await runWeeklyLoop(db, NOW, { reminders: false, clubIds: [c.clubId] })).toEqual({ ...zero, unconfirmed: 1, drafted: 1 });
    expect((await db.select().from(schema.nights).where(eq(schema.nights.id, locked.id)))[0].state).toBe("unconfirmed");
    const [draft] = await draftsOf(c.clubId);
    expect(draft.pickerMembershipId).toBe(c.members.ben);
  });

  test("a postponed picker is skipped, then put first and cleared, exactly as on page load", async ({ page }) => {
    // Two identical clubs: the job drafts one, a page load the other.
    const byJob = await club("Job Postponed Club");
    const byPage = await club("Page Postponed Club");
    const [clubRow] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, byJob.clubId));
    const slot = getNextOccurrence(clubRow, NOW, clubRow.createdAt)!;
    // Ana passed this coming slot (p1: postponed_at = the passed slot).
    for (const c of [byJob, byPage]) {
      await db.update(schema.memberships).set({ postponedAt: slot }).where(eq(schema.memberships.id, c.members.ana));
    }

    const draftByPage = async () => {
      await signInAsUser(page, byPage.users.cal);
      await page.goto(`/clubs/${byPage.clubId}`);
      await expect(page.locator("main")).toBeVisible();
    };

    // Skipped: the slot goes to Ben, and Ana stays postponed.
    expect(await runWeeklyLoop(db, NOW, { reminders: false, clubIds: [byJob.clubId] })).toEqual({ ...zero, drafted: 1 });
    await draftByPage();
    for (const c of [byJob, byPage]) {
      expect((await draftsOf(c.clubId))[0].pickerMembershipId).toBe(c.members.ben);
      expect((await membershipOf(c.members.ana)).postponedAt?.getTime()).toBe(slot.getTime());
    }

    // Ben's night happens; the next draft puts Ana first and clears her.
    for (const c of [byJob, byPage]) {
      await db
        .update(schema.nights)
        .set({ state: "cancelled" })
        .where(and(eq(schema.nights.clubId, c.clubId), eq(schema.nights.state, "draft")));
      await db.insert(schema.nights).values({ clubId: c.clubId, scheduledAt: slot, pickerMembershipId: c.members.ben, state: "watched" });
    }
    expect(await runWeeklyLoop(db, NOW, { reminders: false, clubIds: [byJob.clubId] })).toEqual({ ...zero, drafted: 1 });
    await draftByPage();
    for (const c of [byJob, byPage]) {
      expect((await draftsOf(c.clubId))[0].pickerMembershipId).toBe(c.members.ana);
      expect((await membershipOf(c.members.ana)).postponedAt).toBeNull();
    }
  });

  test(`at most ${DRAFTS_PER_RUN} drafts a run; the rest carry over`, async () => {
    const clubs = [];
    for (let i = 0; i < DRAFTS_PER_RUN + 2; i++) clubs.push(await club(`Job Cap Club ${i}`));
    const clubIds = clubs.map((c) => c.clubId);
    expect(await runWeeklyLoop(db, NOW, { reminders: false, clubIds })).toEqual({ ...zero, drafted: DRAFTS_PER_RUN });
    expect(await runWeeklyLoop(db, NOW, { reminders: false, clubIds })).toEqual({ ...zero, drafted: 2 });
    expect(await runWeeklyLoop(db, NOW, { reminders: false, clubIds })).toEqual(zero);
    for (const c of clubs) expect(await draftsOf(c.clubId)).toHaveLength(1);
  });

  test("never a draft already due to be auto-passed: that slot is skipped, the following one drafted", async () => {
    const c = await club("Job Late Slot Club");
    const [clubRow] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, c.clubId));
    const slot = getNextOccurrence(clubRow, NOW, clubRow.createdAt)!;
    // Ten hours before the slot: its voting deadline (24h before) has gone
    // by, so the following week's night is drafted (ruled 2026-11-23).
    const late = new Date(slot.getTime() - 10 * H);
    expect(await runWeeklyLoop(db, late, { reminders: false, clubIds: [c.clubId] })).toEqual({ ...zero, drafted: 1 });
    const [draft] = await draftsOf(c.clubId);
    expect(draft.scheduledAt.getTime()).toBe(getNextOccurrence(clubRow, new Date(slot.getTime() + 1), clubRow.createdAt)!.getTime());
    expect(draft.scheduledAt.getTime()).toBeGreaterThan(slot.getTime());
    // And the job doesn't pass it the next hour.
    expect(await runWeeklyLoop(db, new Date(late.getTime() + H), { reminders: false, clubIds: [c.clubId] })).toEqual(zero);
  });

  test("a page load right after an auto-pass creates no doomed draft", async ({ page }) => {
    // A club whose next night is 30 hours away, with voting closing 48
    // hours before: that night's voting deadline has already gone by.
    const soon = new Date(NOW.getTime() + 30 * H);
    const local = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(soon);
    const part = (t: string) => local.find((p) => p.type === t)!.value;
    const defaultDay = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(part("weekday"));
    const c = await club("Page After Pass Club", { settings: { lockTime: 48 }, defaultDay, defaultTime: `${part("hour")}:${part("minute")}` });
    const [clubRow] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, c.clubId));
    const slot = getNextOccurrence(clubRow, NOW, clubRow.createdAt)!;
    expect(slot.getTime() - 48 * H).toBeLessThan(NOW.getTime());

    // Ana held that slot and the job passed her turn.
    const { passDraftCore } = await import("../app/clubs/[clubId]/passTurnCore");
    const [held] = await db
      .insert(schema.nights)
      .values({ clubId: c.clubId, scheduledAt: slot, pickerMembershipId: c.members.ana, state: "draft" })
      .returning();
    expect(await passDraftCore(db, held)).toBe(true);

    // A page load now: the successor is Ben's, for the following week, not
    // the doomed slot.
    await signInAsUser(page, c.users.ben);
    await page.goto(`/clubs/${c.clubId}`);
    await expect(page.locator("main")).toBeVisible();
    const [successor] = await draftsOf(c.clubId);
    expect(successor.pickerMembershipId).toBe(c.members.ben);
    expect(successor.scheduledAt.getTime()).toBe(getNextOccurrence(clubRow, new Date(slot.getTime() + 1), clubRow.createdAt)!.getTime());
    // So the next hourly run doesn't pass it.
    expect(await runWeeklyLoop(db, new Date(NOW.getTime() + H), { reminders: false, clubIds: [c.clubId] })).toEqual(zero);
  });
});
