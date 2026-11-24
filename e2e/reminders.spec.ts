import { neon } from "@neondatabase/serverless";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../db/schema";
import { withOpsAlert } from "../app/scheduledJobs";
import { ScheduledJobFailure } from "../app/scheduledJobFailure";
import { runWeeklyLoop } from "../app/weeklyLoop";
import { LEGAL } from "../lib/legal";
import { expect, test } from "./fixtures";
import { EMAIL_OUTBOX_FILE, sentTo, type SentEmail } from "./outbox";

// Reminder emails (ruled 2026-11-23, docs/onboarding-spec.md §5.9): step f
// of the hourly loop, called directly with the Worker's driver and a chosen
// now (time travel, no waiting), scoped by clubIds, checked through the
// outbox. Every club is in New York; T is Wed 2 Dec 2026, 13:00 there.

const db = drizzle(neon(process.env.E2E_DATABASE_URL!), { schema });
const id = () => crypto.randomUUID();
const H = 3600_000;
const T = new Date("2026-12-02T18:00:00Z");
const at = (hours: number) => new Date(T.getTime() + hours * H);
const consentAt = new Date(Date.UTC(2026, 0, 1));
const origin = () => String(test.info().project.use.baseURL).replace(/\/+$/, "");

// This process loads .env (playwright.config.ts): the outbox, never a real send.
const saved = { ...process.env };
test.beforeAll(() => {
  process.env.SES_ACCESS_KEY_ID = "";
  process.env.SES_SECRET_ACCESS_KEY = "";
  process.env.EMAIL_OUTBOX_FILE = EMAIL_OUTBOX_FILE;
  process.env.SUPPORT_EMAIL = "ops-reminders@kinomato.test";
});
test.afterAll(() => {
  process.env = saved;
});

type People = { ana: string; ben: string; cal: string };
// Ana, Ben and Cal, all with reminders on, consent given. Each test's
// people are its own (`tag` in their addresses).
async function people(tag: string) {
  const users = { ana: id(), ben: id(), cal: id() } as People;
  const emails = { ana: `ana.${tag}@example.com`, ben: `ben.${tag}@example.com`, cal: `cal.${tag}@example.com` } as People;
  for (const key of ["ana", "ben", "cal"] as const) {
    await db.insert(schema.users).values({
      id: users[key],
      email: emails[key],
      displayName: `${key[0].toUpperCase()}${key.slice(1)} R.`,
      ageBracket: "18_plus",
      ageAttestedAt: consentAt,
    });
    await db.insert(schema.consentEvents).values(
      (["terms", "privacy"] as const).map((document) => ({
        userId: users[key],
        document,
        version: LEGAL[document].version,
        acceptedAt: consentAt,
        method: "signup" as const,
      })),
    );
  }
  return { users, emails };
}
type Who = Awaited<ReturnType<typeof people>>;

async function club(who: Who, name: string) {
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
  const members = { ana: id(), ben: id(), cal: id() } as People;
  for (const [i, key] of (["ana", "ben", "cal"] as const).entries()) {
    await db.insert(schema.memberships).values({
      id: members[key],
      clubId,
      userId: who.users[key],
      role: key === "ana" ? "owner" : "member",
      joinedAt: new Date(Date.UTC(2026, 0, i + 1)),
    });
  }
  return { clubId, name, members };
}
type Club = Awaited<ReturnType<typeof club>>;

async function film() {
  return (await db.select({ id: schema.films.id }).from(schema.films).where(eq(schema.films.title, "Arrival")))[0];
}

// Cal is every night's picker, so Ana and Ben never get "your turn".
async function openNight(c: Club, lockAt: Date, scheduledAt = new Date(lockAt.getTime() + 20 * H)) {
  const [night] = await db
    .insert(schema.nights)
    .values({ clubId: c.clubId, scheduledAt, pickerMembershipId: c.members.cal, state: "open", lockAt })
    .returning();
  const [nomination] = await db
    .insert(schema.nominations)
    .values({ nightId: night.id, filmId: (await film()).id, membershipId: c.members.cal, position: 1 })
    .returning();
  return { nightId: night.id, nominationId: nomination.id };
}
async function lockedNight(c: Club, scheduledAt: Date, unconfirmAt = new Date(scheduledAt.getTime() + 60 * H)) {
  const [night] = await db
    .insert(schema.nights)
    .values({
      clubId: c.clubId,
      scheduledAt,
      pickerMembershipId: c.members.cal,
      state: "locked",
      winningFilmId: (await film()).id,
      lockedAt: new Date(scheduledAt.getTime() - 24 * H),
      lockAt: new Date(scheduledAt.getTime() - 24 * H),
      unconfirmAt,
    })
    .returning();
  return night.id;
}
const vote = (nominationId: string, membershipId: string) => db.insert(schema.votes).values({ nominationId, membershipId });
const rsvp = (nightId: string, membershipId: string, status: "yes" | "no") =>
  db.insert(schema.rsvps).values({ nightId, membershipId, status });

const reminders = (address: string): SentEmail[] => sentTo(address).filter((m) => m.kind === "reminder");
const run = (clubIds: string[], now: Date) => runWeeklyLoop(db, now, { clubIds, origin: origin() });

test.describe("reminder emails", () => {
  test("voting closes soon goes to who hasn't voted; plain content, the unsubscribe line and both headers; never twice", async () => {
    const who = await people("vote");
    const c = await club(who, "Vote Reminder Club");
    const { nominationId } = await openNight(c, at(10));
    await vote(nominationId, c.members.ben);

    const counts = await run([c.clubId], T);
    expect(counts).toMatchObject({ reminded: 2, remind_failed: 0, failed: 0 });
    expect(reminders(who.emails.ben)).toEqual([]);
    const [mail] = reminders(who.emails.ana);
    expect(reminders(who.emails.cal)).toHaveLength(1);

    expect(mail.subject).toBe("Voting closes soon in Vote Reminder Club");
    expect(mail.html).toContain("Voting closes Wed 11:00pm. You haven't voted yet.");
    expect(mail.html.indexOf("Don't want these?")).toBeLessThan(mail.html.indexOf("Voting closes"));
    expect(mail.html).toMatch(/Don't want these\? <a href="[^"]+\/unsubscribe\/[A-Za-z0-9_-]{43}">Turn off reminders<\/a>/);
    expect(mail.html).toContain(`href="${origin()}/clubs/${c.clubId}"`);
    expect(mail.html).toContain("At most two reminders a week across your clubs.");
    expect(mail.html).toContain("Mute only Vote Reminder Club");
    expect(mail.text).toContain("Don't want these? Turn off reminders:");
    expect(mail.headers?.["List-Unsubscribe"]).toMatch(/^<.+\/unsubscribe\/[A-Za-z0-9_-]{43}\/one-click>$/);
    expect(mail.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    // No film title, name, vote or count.
    for (const leak of ["Arrival", "Ana R.", "Ben R.", "Cal R.", "1 vote", "voted for"]) {
      expect(mail.html + mail.text + mail.subject, leak).not.toContain(leak);
    }

    // Never twice, however many runs.
    await run([c.clubId], at(1));
    await run([c.clubId], at(2));
    expect(reminders(who.emails.ana)).toHaveLength(1);
  });

  test("muted, turned off, and moot (voted, or locked) get nothing", async () => {
    const who = await people("quiet");
    const c = await club(who, "Muted Club");
    await db.update(schema.users).set({ emailReminders: false }).where(eq(schema.users.id, who.users.ben));
    await db.update(schema.memberships).set({ remindersMutedAt: T }).where(eq(schema.memberships.id, c.members.cal));
    const { nominationId } = await openNight(c, at(10));
    await vote(nominationId, c.members.ana);
    expect(await run([c.clubId], T)).toMatchObject({ reminded: 0 });
    for (const address of Object.values(who.emails)) expect(reminders(address)).toEqual([]);

    // A night already locked: no "voting closes" for it.
    const d = await club(who, "Locked Club");
    await lockedNight(d, at(40));
    expect(await run([d.clubId], T)).toMatchObject({ reminded: 0 });
  });

  test("the same kind in two clubs is one email", async () => {
    const who = await people("merge");
    const a = await club(who, "Merge A Club");
    const b = await club(who, "Merge B Club");
    await openNight(a, at(10));
    await openNight(b, at(12));
    await run([a.clubId, b.clubId], T);
    const mails = reminders(who.emails.ana);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe("Voting closes soon in Merge A Club and Merge B Club");
    expect(mails[0].html).toContain("Mute only Merge A Club");
    expect(mails[0].html).toContain("Mute only Merge B Club");
  });

  test("the budget holds over a simulated week: two, then nothing, then free again after 7 days", async () => {
    const who = await people("budget");
    const a = await club(who, "Budget A Club");
    const b = await club(who, "Budget B Club");
    const c = await club(who, "Budget C Club");
    await openNight(a, at(10)); // voting closes soon
    await lockedNight(b, at(7)); // tonight
    const cNight = await lockedNight(c, at(-20), at(40)); // did you watch it (prompt Wed 9am)
    await rsvp(cNight, c.members.ana, "yes");
    const clubs = [a.clubId, b.clubId, c.clubId];
    const budgeted = () => reminders(who.emails.ana).map((m) => m.subject);

    await run(clubs, T);
    expect(budgeted()).toEqual(["Voting closes soon in Budget A Club", "Movie night tonight: Budget B Club"]);
    // Later that week, more is due (the fill-in, A's own night tonight): no.
    await run(clubs, at(24));
    await run(clubs, at(30));
    expect(budgeted()).toHaveLength(2);

    // Seven days on, a new club's vote: the budget has rolled over.
    const e = await club(who, "Budget E Club");
    await openNight(e, at(7 * 24 + 10));
    await run([...clubs, e.clubId], at(7 * 24 + 1));
    expect(budgeted()).toContain("Voting closes soon in Budget E Club");
    const sent = await db
      .select()
      .from(schema.notificationLog)
      .where(and(eq(schema.notificationLog.userId, who.users.ana), inArray(schema.notificationLog.kind, ["voting_closes", "tonight", "did_you_watch"])));
    const inFirstWeek = new Set(sent.filter((s) => s.sentAt.getTime() < at(7 * 24).getTime()).map((s) => s.sendId));
    expect(inFirstWeek.size).toBe(2);
  });

  test("quiet hours: a due reminder waits for 08:00 in the club's timezone", async () => {
    const who = await people("night");
    const c = await club(who, "Quiet Hours Club");
    // Ana's draft, a week off: "your turn" is due from now on.
    await db.insert(schema.nights).values({ clubId: c.clubId, scheduledAt: at(7 * 24), pickerMembershipId: c.members.ana, state: "draft" });
    await run([c.clubId], new Date("2026-12-02T04:00:00Z")); // Tue 23:00 New York
    await run([c.clubId], new Date("2026-12-02T12:30:00Z")); // Wed 07:30
    expect(reminders(who.emails.ana)).toEqual([]);
    await run([c.clubId], new Date("2026-12-02T13:00:00Z")); // Wed 08:00
    const [mail] = reminders(who.emails.ana);
    expect(mail.subject).toBe("Your turn to pick for Quiet Hours Club");
    expect(mail.text).toContain("or your turn passes to the next person.");
  });

  test("one-click unsubscribe: a POST stops all reminder emails; a browser GET shows the page and changes nothing", async ({ page }) => {
    const who = await people("oneclick");
    const c = await club(who, "One Click Club");
    await openNight(c, at(10));
    await run([c.clubId], T);
    const header = reminders(who.emails.ana)[0].headers!["List-Unsubscribe"];
    const url = header.slice(1, -1);
    const remindersOn = async () =>
      (await db.select().from(schema.users).where(eq(schema.users.id, who.users.ana)))[0].emailReminders;

    await page.goto(url);
    await expect(page.getByRole("heading", { name: "Reminder emails" })).toBeVisible();
    expect(page.url()).not.toContain("one-click");
    expect(await remindersOn()).toBe(true);

    // Anything but the one-click body is refused.
    expect((await page.request.post(url, { headers: { "content-type": "application/x-www-form-urlencoded" }, data: "x=1" })).status()).toBe(400);
    expect(await remindersOn()).toBe(true);

    const res = await page.request.post(url, {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      data: "List-Unsubscribe=One-Click",
    });
    expect(res.status()).toBe(200);
    expect(await remindersOn()).toBe(false);
  });

  test("a failed send leaves the locks done, releases its claim, fails the run and alerts", async () => {
    const who = await people("fail");
    const due = await club(who, "Failing Lock Club");
    const lockingNight = await openNight(due, at(-1));
    const c = await club(who, "Failing Send Club");
    const { nightId } = await openNight(c, at(10));

    const error = await withOpsAlert("weekly-loop", T, () =>
      runWeeklyLoop(db, T, {
        clubIds: [due.clubId, c.clubId],
        origin: origin(),
        sendReminder: async () => {
          throw new Error("SES is down");
        },
      }),
    ).catch((e) => e);
    expect(error).toBeInstanceOf(ScheduledJobFailure);
    expect((error as ScheduledJobFailure).counts).toMatchObject({ locked: 1, reminded: 0, failed: 0 });
    expect((error as ScheduledJobFailure).counts.remind_failed).toBeGreaterThanOrEqual(1);

    // The lock stands; the claim is gone, so the next hour retries.
    expect((await db.select().from(schema.nights).where(eq(schema.nights.id, lockingNight.nightId)))[0].state).toBe("locked");
    expect(await db.select().from(schema.notificationLog).where(eq(schema.notificationLog.nightId, nightId))).toEqual([]);
    expect(reminders(who.emails.ana)).toEqual([]);
    const alert = sentTo("ops-reminders@kinomato.test").filter((m) => m.kind === "ops-alert").at(-1)!;
    expect(alert.html).toMatch(/remind failed [1-9]/);
    expect(alert.html).not.toContain("Failing Send Club");
    expect(alert.html).not.toContain("@example.com");

    // The next hour, with sending back: it goes.
    await run([c.clubId], at(1));
    expect(reminders(who.emails.ana)).toHaveLength(1);
  });
});
