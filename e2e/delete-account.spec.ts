import type { Page } from "@playwright/test";
import { desc, eq, inArray, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import { getAuthSecret, hashCode } from "../lib/authCredentials";
import { LEGAL } from "../lib/legal";
import { expect, test } from "./fixtures";
import { sentTo } from "./outbox";
import { signInAsUser } from "./session";
import { finishCodeSignIn, KNOWN_CODE } from "./signIn";

// Delete account (docs/onboarding-spec.md §11.4; launch foundations (f)).
// Builds its own people and clubs, so no seeded club changes:
// - Dee owns Keep Club (members Mo, then Ann: no admin, so Mo inherits) and
//   Admin Club (member Moe joined first, admin Abe later: Abe inherits),
//   is a plain member of Other Club (Ola owns it), and is the last active
//   member of Solo Club, which Lu left long ago and which has a night,
//   nominations, a vote, a veto, RSVPs, a rating with a tag, a season, a
//   pending invite and Dee's hard limit.
// - Ivy is only for the code rules: wrong codes, cancel, the daily cap.
test.describe.configure({ mode: "serial" });

type Db = ReturnType<typeof drizzle<typeof schema>>;
async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = postgres(process.env.E2E_DATABASE_URL!);
  try {
    return await fn(drizzle(client, { schema }));
  } finally {
    await client.end();
  }
}

const id = () => crypto.randomUUID();
const at = (n: number) => new Date(Date.UTC(2026, 0, n));
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

const P = {
  dee: { id: id(), email: "dee.delete@example.com", name: "Dee F." },
  mo: { id: id(), email: "mo.delete@example.com", name: "Mo C." },
  ann: { id: id(), email: "ann.delete@example.com", name: "Ann D." },
  moe: { id: id(), email: "moe.delete@example.com", name: "Moe E." },
  abe: { id: id(), email: "abe.delete@example.com", name: "Abe B." },
  ola: { id: id(), email: "ola.delete@example.com", name: "Ola G." },
  lu: { id: id(), email: "lu.delete@example.com", name: "Lu H." },
  ivy: { id: id(), email: "ivy.delete@example.com", name: "Ivy J." },
};
const CLUB = { keep: id(), admin: id(), other: id(), solo: id() };
const M = {
  deeKeep: id(),
  mo: id(),
  ann: id(),
  deeAdmin: id(),
  moe: id(),
  abe: id(),
  ola: id(),
  deeOther: id(),
  deeSolo: id(),
  lu: id(),
};
const SOLO_INVITE_TOKEN = `solo-${id()}`;

async function seed(db: Db) {
  const people = Object.values(P);
  await db.insert(schema.users).values(
    people.map((p) => ({ id: p.id, email: p.email, displayName: p.name, ageBracket: "18_plus" as const, ageAttestedAt: at(1) })),
  );
  await db.insert(schema.consentEvents).values(
    people.flatMap((p) =>
      (["terms", "privacy"] as const).map((document) => ({
        userId: p.id,
        document,
        version: LEGAL[document].version,
        acceptedAt: at(1),
        method: "signup" as const,
      })),
    ),
  );
  const club = (clubId: string, name: string) => ({
    id: clubId,
    name,
    cadence: "weekly" as const,
    defaultDay: 6,
    defaultTime: "20:00",
    timezone: "America/New_York",
    mode: "in_person" as const,
  });
  await db
    .insert(schema.clubs)
    .values([club(CLUB.keep, "Keep Club"), club(CLUB.admin, "Admin Club"), club(CLUB.other, "Other Club"), club(CLUB.solo, "Solo Club")]);
  await db.insert(schema.memberships).values([
    { id: M.deeKeep, clubId: CLUB.keep, userId: P.dee.id, role: "owner", joinedAt: at(1) },
    { id: M.mo, clubId: CLUB.keep, userId: P.mo.id, role: "member", joinedAt: at(2) },
    { id: M.ann, clubId: CLUB.keep, userId: P.ann.id, role: "member", joinedAt: at(3) },
    { id: M.deeAdmin, clubId: CLUB.admin, userId: P.dee.id, role: "owner", joinedAt: at(1) },
    { id: M.moe, clubId: CLUB.admin, userId: P.moe.id, role: "member", joinedAt: at(2) },
    { id: M.abe, clubId: CLUB.admin, userId: P.abe.id, role: "admin", joinedAt: at(5) },
    { id: M.ola, clubId: CLUB.other, userId: P.ola.id, role: "owner", joinedAt: at(1) },
    { id: M.deeOther, clubId: CLUB.other, userId: P.dee.id, role: "member", joinedAt: at(2) },
    { id: M.deeSolo, clubId: CLUB.solo, userId: P.dee.id, role: "owner", joinedAt: at(1) },
    { id: M.lu, clubId: CLUB.solo, userId: P.lu.id, role: "member", joinedAt: at(2), leftAt: at(9) },
  ]);
  const films = await db.select().from(schema.films).limit(2);

  // Keep Club: a watched night Dee picked, for the "Former member" check.
  await db
    .insert(schema.nights)
    .values({
      clubId: CLUB.keep,
      scheduledAt: daysAgo(10),
      pickerMembershipId: M.deeKeep,
      state: "watched",
      winningFilmId: films[0].id,
      lockedAt: daysAgo(11),
      confirmedAt: daysAgo(9),
      confirmedBy: M.deeKeep,
    });

  // Solo Club: something in every club table.
  const [season] = await db.insert(schema.seasons).values({ clubId: CLUB.solo, startedAt: daysAgo(60) }).returning();
  const [soloNight] = await db
    .insert(schema.nights)
    .values({
      clubId: CLUB.solo,
      scheduledAt: daysAgo(20),
      pickerMembershipId: M.lu,
      state: "watched",
      winningFilmId: films[0].id,
      lockedAt: daysAgo(21),
      confirmedAt: daysAgo(19),
      confirmedBy: M.lu,
    })
    .returning();
  const [n1, n2] = await db
    .insert(schema.nominations)
    .values([
      { nightId: soloNight.id, filmId: films[0].id, membershipId: M.lu },
      { nightId: soloNight.id, filmId: films[1].id, membershipId: M.lu },
    ])
    .returning();
  await db.insert(schema.votes).values([
    { nominationId: n1.id, membershipId: M.deeSolo },
    { nominationId: n1.id, membershipId: M.lu },
  ]);
  await db.insert(schema.vetoes).values({ nightId: soloNight.id, nominationId: n2.id, membershipId: M.deeSolo, seasonId: season.id });
  await db.insert(schema.rsvps).values([
    { nightId: soloNight.id, membershipId: M.deeSolo, status: "yes" },
    { nightId: soloNight.id, membershipId: M.lu, status: "yes" },
  ]);
  const [rating] = await db
    .insert(schema.ratings)
    .values({ nightId: soloNight.id, membershipId: M.lu, scoreQuality: "7.0", scoreFun: "6.0", hotTake: "Lu's take" })
    .returning();
  const [tag] = await db.insert(schema.tags).values({ clubId: CLUB.solo, name: "moody", displayName: "Moody" }).returning();
  await db.insert(schema.ratingTags).values({ ratingId: rating.id, tagId: tag.id });
  await db.insert(schema.constraints).values({ membershipId: M.deeSolo, kind: "hard", ruleType: "genre", value: "27", label: "Horror" });
  await db
    .insert(schema.invites)
    .values({ clubId: CLUB.solo, token: SOLO_INVITE_TOKEN, inviteeName: "Pat Q.", invitedByMembershipId: M.deeSolo });
}

// The code is stored only as a hash: overwrite the newest request's with
// one for a code the test knows, as e2e/signIn.ts does for sign-in. A
// direct write to the E2E database, never an app route.
async function setKnownDeletionCode(userId: string) {
  await withDb(async (db) => {
    const [row] = await db
      .select({ id: schema.accountDeletionRequests.id })
      .from(schema.accountDeletionRequests)
      .where(eq(schema.accountDeletionRequests.userId, userId))
      .orderBy(desc(schema.accountDeletionRequests.createdAt))
      .limit(1);
    await db
      .update(schema.accountDeletionRequests)
      .set({ codeHash: hashCode(KNOWN_CODE, getAuthSecret()) })
      .where(eq(schema.accountDeletionRequests.id, row.id));
  });
}

const requestsOf = (userId: string) =>
  withDb((db) =>
    db
      .select()
      .from(schema.accountDeletionRequests)
      .where(eq(schema.accountDeletionRequests.userId, userId))
      .orderBy(desc(schema.accountDeletionRequests.createdAt)),
  );

async function askForCode(page: Page) {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Send me a code" }).click();
}

const alert = (page: Page) => page.locator("main").getByRole("alert");

test.describe("Delete account", () => {
  test.beforeAll(async () => {
    await withDb(seed);
  });

  test("five wrong codes lock it; Cancel works; three requests a day", async ({ page }) => {
    await signInAsUser(page, P.ivy.id);
    await askForCode(page);
    await expect(page).toHaveURL("/settings/delete-account");
    expect(sentTo(P.ivy.email).filter((m) => m.kind === "account-deletion-code")).toHaveLength(1);

    for (let i = 1; i <= 5; i++) {
      await page.getByLabel("Code").fill("000000");
      await page.getByRole("button", { name: "Delete my account" }).click();
      await expect(alert(page)).toHaveText(i < 5 ? "That code didn't work." : "Too many wrong codes. Ask for a new one.");
    }
    // Locked: no code field, only a new code.
    await expect(page.getByLabel("Code")).toHaveCount(0);
    expect((await requestsOf(P.ivy.id))[0].attempts).toBe(5);

    // A second request (two of three today), then Cancel.
    await page.getByRole("button", { name: "Send me a code" }).click();
    await expect(page.getByLabel("Code")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page).toHaveURL("/settings");
    expect((await requestsOf(P.ivy.id))[0].cancelledAt).not.toBeNull();

    // The third is allowed, the fourth isn't.
    await askForCode(page);
    await expect(page).toHaveURL("/settings/delete-account");
    await askForCode(page);
    await expect(page).toHaveURL(/\/settings\?deleteError=/);
    await expect(alert(page)).toHaveText("You can ask for a deletion code 3 times a day. Try again tomorrow.");
    expect(await requestsOf(P.ivy.id)).toHaveLength(3);
    // Still an account, still signed in.
    const [ivy] = await withDb((db) => db.select().from(schema.users).where(eq(schema.users.id, P.ivy.id)));
    expect(ivy.displayName).toBe(P.ivy.name);
  });

  test("the confirmation screen says what happens to each club, by name", async ({ page }) => {
    await signInAsUser(page, P.dee.id);
    await askForCode(page);
    await expect(page.locator(".deletion-plan li")).toHaveText([
      "Abe B. will become the owner of Admin Club.",
      "Mo C. will become the owner of Keep Club.",
      "You'll leave Other Club.",
      "Solo Club will be deleted, with all its nights, ratings and history, because you're its last member.",
    ]);
  });

  test("deleting: anonymised and signed out, ownership passed on, a last-member club gone", async ({ page, browser }) => {
    await signInAsUser(page, P.dee.id);
    await page.goto("/settings/delete-account");
    await setKnownDeletionCode(P.dee.id);
    await page.getByLabel("Code").fill(KNOWN_CODE);
    await page.getByRole("button", { name: "Delete my account" }).click();
    await expect(page).toHaveURL("/account-deleted");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your account was deleted.");
    // Signed out.
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Whose turn is it?" })).toBeVisible();

    const after = await withDb(async (db) => {
      const [dee] = await db.select().from(schema.users).where(eq(schema.users.id, P.dee.id));
      const roles = await db
        .select({ id: schema.memberships.id, role: schema.memberships.role, leftAt: schema.memberships.leftAt })
        .from(schema.memberships)
        .where(inArray(schema.memberships.id, [M.mo, M.abe, M.moe, M.deeKeep, M.deeAdmin, M.deeOther]));
      return {
        dee,
        roles: Object.fromEntries(roles.map((r) => [r.id, r])),
        sessions: await db.select().from(schema.sessions).where(eq(schema.sessions.userId, P.dee.id)),
        requests: await db
          .select()
          .from(schema.accountDeletionRequests)
          .where(eq(schema.accountDeletionRequests.userId, P.dee.id)),
      };
    });
    // §11.4: anonymised, released, signed out everywhere.
    expect(after.dee.displayName).toBe("Former member");
    expect(after.dee.email).toBe(`deleted-${P.dee.id}@deleted.kinomato.invalid`);
    expect(after.sessions).toEqual([]);
    expect(after.requests).toEqual([]);
    // Ownership: the earliest member where there's no admin, the admin
    // where there is one. Everyone else unchanged; Dee left each club.
    expect(after.roles[M.mo].role).toBe("owner");
    expect(after.roles[M.abe].role).toBe("owner");
    expect(after.roles[M.moe].role).toBe("member");
    for (const m of [M.deeKeep, M.deeAdmin, M.deeOther]) expect(after.roles[m].leftAt).not.toBeNull();

    // Solo Club is gone: no row left for it in any club table, including
    // Lu's, who left long before.
    const left = await withDb(async (db) => {
      const soloMemberships = [M.deeSolo, M.lu];
      return {
        clubs: await db.select().from(schema.clubs).where(eq(schema.clubs.id, CLUB.solo)),
        memberships: await db.select().from(schema.memberships).where(eq(schema.memberships.clubId, CLUB.solo)),
        nights: await db.select().from(schema.nights).where(eq(schema.nights.clubId, CLUB.solo)),
        seasons: await db.select().from(schema.seasons).where(eq(schema.seasons.clubId, CLUB.solo)),
        tags: await db.select().from(schema.tags).where(eq(schema.tags.clubId, CLUB.solo)),
        invites: await db.select().from(schema.invites).where(eq(schema.invites.clubId, CLUB.solo)),
        nominations: await db.select().from(schema.nominations).where(inArray(schema.nominations.membershipId, soloMemberships)),
        votes: await db.select().from(schema.votes).where(inArray(schema.votes.membershipId, soloMemberships)),
        vetoes: await db.select().from(schema.vetoes).where(inArray(schema.vetoes.membershipId, soloMemberships)),
        rsvps: await db.select().from(schema.rsvps).where(inArray(schema.rsvps.membershipId, soloMemberships)),
        ratings: await db.select().from(schema.ratings).where(inArray(schema.ratings.membershipId, soloMemberships)),
        constraints: await db.select().from(schema.constraints).where(inArray(schema.constraints.membershipId, soloMemberships)),
        ratingTags: await db
          .select()
          .from(schema.ratingTags)
          .innerJoin(schema.tags, eq(schema.ratingTags.tagId, schema.tags.id))
          .where(eq(schema.tags.name, "moody")),
      };
    });
    for (const [table, rows] of Object.entries(left)) expect(rows, table).toEqual([]);

    // Its pending invite link stopped working.
    await page.goto(`/invite/${SOLO_INVITE_TOKEN}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This invite link was replaced");

    // The receipt went to the old address, and said nothing else.
    const receipts = sentTo(P.dee.email).filter((m) => m.kind === "account-deleted-receipt");
    expect(receipts).toHaveLength(1);
    expect(receipts[0].html).toBe("<p>Your Kinomato account was deleted.</p>");

    // Mo now owns Keep Club and sees its owner controls; Dee's pick there
    // reads "Former member".
    const context = await browser.newContext();
    try {
      const mo = await context.newPage();
      await signInAsUser(mo, P.mo.id);
      await mo.goto(`/clubs/${CLUB.keep}/members`);
      await expect(mo.locator("main").getByRole("heading", { name: "Add a person" })).toBeVisible();
      await mo.goto(`/clubs/${CLUB.keep}/history`);
      const night = mo.locator("main li.history-night");
      await expect(night).toHaveCount(1);
      await expect(night).toContainText("Former member's pick");
      await expect(mo.locator("main")).not.toContainText(P.dee.name);
    } finally {
      await context.close();
    }
  });

  test("the old address can sign up fresh afterwards", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(P.dee.email);
    await page.getByRole("button", { name: "Send code" }).click();
    await finishCodeSignIn(page, P.dee.email);
    await expect(page).toHaveURL(/\/welcome/);
    const rows = await withDb((db) =>
      db
        .select()
        .from(schema.users)
        .where(or(eq(schema.users.email, P.dee.email), eq(schema.users.id, P.dee.id))),
    );
    // A new account on the address; the old one stays anonymised.
    expect(rows).toHaveLength(2);
    const fresh = rows.find((r) => r.email === P.dee.email)!;
    expect(fresh.id).not.toBe(P.dee.id);
    expect(fresh.displayName).toBeNull();
    expect(rows.find((r) => r.id === P.dee.id)!.displayName).toBe("Former member");
  });
});
