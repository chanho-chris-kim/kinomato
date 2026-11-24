import { neon } from "@neondatabase/serverless";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../db/schema";
import { lockNightCore } from "../app/clubs/[clubId]/lockNightCore";
import { withOpsAlert } from "../app/scheduledJobs";
import { ScheduledJobFailure } from "../app/scheduledJobFailure";
import { LOCKS_PER_RUN, runWeeklyLoop } from "../app/weeklyLoop";
import { LEGAL } from "../lib/legal";
import { expect, test } from "./fixtures";
import { EMAIL_OUTBOX_FILE, sentTo } from "./outbox";
import { signInAsUser } from "./session";

// The hourly weekly loop (CLAUDE.md "Night deadlines", ruled 2026-11-19/21),
// called directly against this run's database with the Worker's own driver
// (neon-http), the way e2e/retention.spec.ts calls its job: the Cron
// Trigger is the only thing that runs it in production. Time travel by the
// `now` passed in, never by waiting. Every run is scoped to the clubs the
// test made (clubIds), so seeded clubs are never touched.

const db = drizzle(neon(process.env.E2E_DATABASE_URL!), { schema });
const id = () => crypto.randomUUID();
const H = 3600_000;
const NOW = new Date();
const hours = (n: number) => new Date(NOW.getTime() + n * H);
const at = new Date(Date.UTC(2026, 0, 1));
type Settings = Record<string, unknown>;

// Ana (owner), Ben and Cal, consent given. Ben and Cal picked watched
// nights 20 and 13 days ago, so if Ana's night counts as her pick, Ben is
// next; if it didn't, Ana would be.
async function club(name: string, opts: { settings?: Settings; paused?: boolean } = {}) {
  const clubId = id();
  await db.insert(schema.clubs).values({
    id: clubId,
    name,
    cadence: "weekly",
    defaultDay: 6,
    defaultTime: "20:00",
    timezone: "America/New_York",
    mode: "in_person",
    settings: opts.settings ?? {},
    pausedAt: opts.paused ? hours(-48) : null,
  });
  const users = { ana: id(), ben: id(), cal: id() };
  const members = { ana: id(), ben: id(), cal: id() };
  for (const [i, key] of (["ana", "ben", "cal"] as const).entries()) {
    await db.insert(schema.users).values({
      id: users[key],
      email: `${key}.${clubId.slice(0, 8)}@example.com`,
      displayName: `${key[0].toUpperCase()}${key.slice(1)} L.`,
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
  // Earlier, finished picks for Ben and Cal (Cal's was Thief, watched).
  await db.insert(schema.nights).values([
    { clubId, scheduledAt: hours(-24 * 20), pickerMembershipId: members.ben, state: "watched", winningFilmId: film("Hereditary").id },
    { clubId, scheduledAt: hours(-24 * 13), pickerMembershipId: members.cal, state: "watched", winningFilmId: film("Thief").id },
  ]);
  return { clubId, users, members, film };
}

type Club = Awaited<ReturnType<typeof club>>;

async function openNight(c: Club, lockAt: Date | null, nominate = true) {
  const [night] = await db
    .insert(schema.nights)
    .values({ clubId: c.clubId, scheduledAt: hours(30), pickerMembershipId: c.members.ana, state: "open", lockAt })
    .returning();
  if (nominate) {
    await db.insert(schema.nominations).values([
      { nightId: night.id, filmId: c.film("Thief").id, membershipId: c.members.ana, position: 2 },
      { nightId: night.id, filmId: c.film("Arrival").id, membershipId: c.members.ana, position: 1 },
    ]);
  }
  return night.id;
}

async function lockedNight(c: Club, o: { scheduledAt: Date; unconfirmAt: Date | null }) {
  const [night] = await db
    .insert(schema.nights)
    .values({
      clubId: c.clubId,
      scheduledAt: o.scheduledAt,
      pickerMembershipId: c.members.ana,
      state: "locked",
      winningFilmId: c.film("Arrival").id,
      lockedAt: new Date(o.scheduledAt.getTime() - 24 * H),
      lockAt: new Date(o.scheduledAt.getTime() - 24 * H),
      unconfirmAt: o.unconfirmAt,
    })
    .returning();
  await db.insert(schema.nominations).values({ nightId: night.id, filmId: c.film("Arrival").id, membershipId: c.members.ana, position: 1 });
  return night.id;
}

const nightRow = async (nightId: string) => (await db.select().from(schema.nights).where(eq(schema.nights.id, nightId)))[0];
const zero = { locked: 0, unconfirmed: 0, passed: 0, drafted: 0, failed: 0 };

test.describe("the weekly loop", () => {
  test("an open night past lock_at locks, the picker's first choice winning with no votes; a second run changes nothing", async () => {
    const c = await club("Loop Lock Club");
    const due = await openNight(c, hours(-1));
    const notYet = await openNight(await club("Loop Later Club"), hours(1));

    expect(await runWeeklyLoop(db, NOW, { clubIds: [c.clubId] })).toEqual({ ...zero, locked: 1 });
    const night = await nightRow(due);
    expect(night.state).toBe("locked");
    expect(night.winningFilmId).toBe(c.film("Arrival").id);
    expect(night.unconfirmAt).not.toBeNull();
    expect((await nightRow(notYet)).state).toBe("open");

    expect(await runWeeklyLoop(db, NOW, { clubIds: [c.clubId] })).toEqual(zero);
  });

  test(`at most ${LOCKS_PER_RUN} locks a run, oldest deadline first; the rest carry over to the next run`, async () => {
    const clubs = await Promise.all([1, 2, 3, 4, 5, 6, 7].map((n) => club(`Loop Cap Club ${n}`)));
    const nightIds = await Promise.all(clubs.map((c, i) => openNight(c, hours(-(i + 1)))));
    const clubIds = clubs.map((c) => c.clubId);

    const cpu = process.cpuUsage();
    expect(await runWeeklyLoop(db, NOW, { clubIds })).toEqual({ ...zero, locked: 5 });
    const used = process.cpuUsage(cpu);
    console.log(`[weekly-loop cpu] 5 locks: ${((used.user + used.system) / 1000).toFixed(1)} ms in Node (not workerd)`);
    // The two newest deadlines (1h and 2h ago) wait.
    const states = await Promise.all(nightIds.map(async (n) => (await nightRow(n)).state));
    expect(states).toEqual(["open", "open", "locked", "locked", "locked", "locked", "locked"]);

    expect(await runWeeklyLoop(db, NOW, { clubIds })).toEqual({ ...zero, locked: 2 });
    expect(await runWeeklyLoop(db, NOW, { clubIds })).toEqual(zero);
  });

  test("a locked night past unconfirm_at becomes unconfirmed: the turn moves on, and it's never counted as watched", async ({
    page,
  }) => {
    const c = await club("Loop Unconfirmed Club");
    // Saturday's night 3 days ago; logged two days from now, so travel 3 days on.
    const nightId = await lockedNight(c, { scheduledAt: hours(-72), unconfirmAt: hours(48) });
    expect(await runWeeklyLoop(db, NOW, { clubIds: [c.clubId] })).toEqual(zero);
    const later = hours(72);
    // Its successor is drafted in the same run (step e, ruled 2026-11-22).
    expect(await runWeeklyLoop(db, later, { clubIds: [c.clubId] })).toEqual({ ...zero, unconfirmed: 1, drafted: 1 });

    const night = await nightRow(nightId);
    expect(night.state).toBe("unconfirmed");
    expect(night.unconfirmedAt?.getTime()).toBe(later.getTime());
    expect(night.confirmedAt?.getTime()).toBe(later.getTime());
    expect(night.confirmedBy).toBeNull();

    // The turn moves on: the next draft is Ben's, not Ana's again.
    await signInAsUser(page, c.users.cal);
    await page.goto(`/clubs/${c.clubId}`);
    const [draft] = await db
      .select()
      .from(schema.nights)
      .where(and(eq(schema.nights.clubId, c.clubId), eq(schema.nights.state, "draft")));
    expect(draft.pickerMembershipId).toBe(c.members.ben);

    // History: unconfirmed, no attendees or ratings.
    await page.goto(`/clubs/${c.clubId}/history`);
    const item = page.locator("li.history-night", { hasText: "Nobody confirmed whether the club watched it." });
    await expect(item).toHaveCount(1);
    await expect(item).not.toContainText("Came:");

    // The "club watched this" badge: Thief (watched) has it, Arrival doesn't.
    await page.goto(`/watchlist?${new URLSearchParams({ seen: c.clubId, q: "Thief" })}`);
    await expect(page.locator(".watched-badge").first()).toBeVisible();
    await page.goto(`/watchlist?${new URLSearchParams({ seen: c.clubId, q: "Arrival" })}`);
    await expect(page.locator(".result, li").filter({ hasText: "Arrival" }).first()).toBeVisible();
    await expect(page.locator(".watched-badge")).toHaveCount(0);
  });

  test("not yet confirmable, or not yet due: untouched", async () => {
    // Stored deadline already past, but a same-night prompt for a night
    // still two hours off hasn't appeared: it waits for the prompt.
    const c = await club("Loop Early Club", { settings: { confirmAt: "same_night" } });
    const early = await lockedNight(c, { scheduledAt: hours(2), unconfirmAt: hours(-1) });
    const d = await club("Loop Not Due Club");
    const notDue = await lockedNight(d, { scheduledAt: hours(-30), unconfirmAt: hours(5) });
    expect(await runWeeklyLoop(db, NOW, { clubIds: [c.clubId, d.clubId] })).toEqual(zero);
    expect((await nightRow(early)).state).toBe("locked");
    expect((await nightRow(notDue)).state).toBe("locked");
    // Once the night has started, the first is due.
    expect(await runWeeklyLoop(db, hours(3), { clubIds: [c.clubId] })).toEqual({ ...zero, unconfirmed: 1, drafted: 1 });
  });

  test("a NULL deadline uses the same fallback: lockTime before the night, autoAdvance after the prompt", async () => {
    const c = await club("Loop Old Night Club", { settings: { lockTime: 6 } });
    const open = await openNight(c, null); // scheduled 30h ahead; due 24h on
    expect(await runWeeklyLoop(db, hours(23), { clubIds: [c.clubId] })).toEqual(zero);
    expect(await runWeeklyLoop(db, hours(24), { clubIds: [c.clubId] })).toEqual({ ...zero, locked: 1 });
    expect((await nightRow(open)).state).toBe("locked");
  });

  test("a draft still unopened when voting would have closed is passed, and Passed this turn shows", async ({ page }) => {
    const c = await club("Loop Pass Club");
    const [draft] = await db
      .insert(schema.nights)
      .values({ clubId: c.clubId, scheduledAt: hours(20), pickerMembershipId: c.members.ana, state: "draft" })
      .returning();
    const [opened] = await db
      .insert(schema.nights)
      .values({ clubId: (await club("Loop Busy Club")).clubId, scheduledAt: hours(30), pickerMembershipId: c.members.ana, state: "draft" })
      .returning();

    expect(await runWeeklyLoop(db, NOW, { clubIds: [c.clubId, opened.clubId] })).toEqual({ ...zero, passed: 1, drafted: 1 });
    expect(await db.select().from(schema.nights).where(eq(schema.nights.id, draft.id))).toEqual([]);
    const [ana] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, c.members.ana));
    expect(ana.postponedAt?.getTime()).toBe(draft.scheduledAt.getTime());
    expect((await nightRow(opened.id)).state).toBe("draft"); // 30h off: not due

    await signInAsUser(page, c.users.ben);
    await page.goto(`/clubs/${c.clubId}/members`);
    await expect(page.locator("main li", { hasText: "Ana L." }).first()).toContainText("Passed this turn");
    expect(await runWeeklyLoop(db, NOW, { clubIds: [c.clubId] })).toEqual(zero);
  });

  test("a person closing voting in the same instant as the job: one lock", async () => {
    const c = await club("Loop Race Club");
    const nightId = await openNight(c, hours(-1));
    const [job, button] = await Promise.all([runWeeklyLoop(db, NOW, { clubIds: [c.clubId] }), lockNightCore(db, nightId)]);
    expect(job.locked + (button === "locked" ? 1 : 0)).toBe(1);
    expect((await nightRow(nightId)).state).toBe("locked");
  });

  test("a person answering Yes in the same instant as the job: one result", async () => {
    const c = await club("Loop Confirm Race Club");
    const nightId = await lockedNight(c, { scheduledAt: hours(-72), unconfirmAt: hours(-1) });
    // confirmNight's own conditional write (it's a server action, so its
    // write is run here directly).
    const [job, answered] = await Promise.all([
      runWeeklyLoop(db, NOW, { clubIds: [c.clubId] }),
      db
        .update(schema.nights)
        .set({ state: "watched", confirmedAt: NOW, confirmedBy: c.members.cal })
        .where(and(eq(schema.nights.id, nightId), inArray(schema.nights.state, ["draft", "open", "locked"])))
        .returning({ id: schema.nights.id }),
    ]);
    expect(job.unconfirmed + answered.length).toBe(1);
    expect(["watched", "unconfirmed"]).toContain((await nightRow(nightId)).state);
  });

  test("a paused club's night in flight still resolves", async () => {
    const c = await club("Loop Paused Club", { paused: true });
    const nightId = await openNight(c, hours(-1));
    expect(await runWeeklyLoop(db, NOW, { clubIds: [c.clubId] })).toEqual({ ...zero, locked: 1 });
    expect((await nightRow(nightId)).state).toBe("locked");
  });

  test("a failure fails the run, the rest still run, and an ops alert with no personal data goes to SUPPORT_EMAIL", async () => {
    const saved = { ...process.env };
    // This process loads .env (playwright.config.ts): never a real send.
    process.env.SES_ACCESS_KEY_ID = "";
    process.env.SES_SECRET_ACCESS_KEY = "";
    process.env.EMAIL_OUTBOX_FILE = EMAIL_OUTBOX_FILE;
    process.env.SUPPORT_EMAIL = "ops-alerts@kinomato.test";
    try {
      const broken = await club("Loop Broken Club");
      await openNight(broken, hours(-2), false); // no nominations: lock throws
      const fine = await club("Loop Fine Club");
      const fineNight = await openNight(fine, hours(-1));
      const runAt = new Date(NOW.getTime() + 1000);

      const error = await withOpsAlert("weekly-loop", runAt, () =>
        runWeeklyLoop(db, runAt, { clubIds: [broken.clubId, fine.clubId] }),
      ).catch((e) => e);
      expect(error).toBeInstanceOf(ScheduledJobFailure);
      expect((error as ScheduledJobFailure).counts).toEqual({ ...zero, locked: 1, failed: 1 });
      expect((await nightRow(fineNight)).state).toBe("locked");

      const alerts = sentTo("ops-alerts@kinomato.test").filter((m) => m.kind === "ops-alert");
      expect(alerts).toHaveLength(1);
      const text = alerts[0].subject + alerts[0].html;
      expect(alerts[0].subject).toBe("Kinomato: the weekly-loop job failed");
      expect(text).toContain(runAt.toISOString());
      expect(text).toContain("Counts: locked 1, unconfirmed 0, passed 0, drafted 0, failed 1.");
      expect(text).toContain("See Workers Logs");
      for (const personal of ["Loop Broken Club", "Loop Fine Club", "Ana L.", "@example.com", broken.clubId, "Nothing to lock"]) {
        expect(text).not.toContain(personal);
      }
    } finally {
      process.env = saved;
    }
  });
});
