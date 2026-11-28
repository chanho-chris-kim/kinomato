import type { Browser, Locator, Page } from "@playwright/test";
import { neon } from "@neondatabase/serverless";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../db/schema";
import { generateJoinCode } from "../lib/joinCode";
import { LEGAL } from "../lib/legal";
import { expect, test } from "./fixtures";
import { signInAsUser } from "./session";
import { expectNoneContain, recordRequestUrls } from "./signIn";

// The Members redesign (u6, ruled 2026-11-27): the main page and its
// sub-pages, for an owner, an admin and a plain member. Builds its own
// people and clubs. Every server check is the existing actions'; these
// tests drive them from the new pages.

const db = drizzle(neon(process.env.E2E_DATABASE_URL!), { schema });
const id = () => crypto.randomUUID();
const RUN = id().slice(0, 8);
const at = new Date(Date.UTC(2026, 0, 1));

async function person(displayName: string) {
  const userId = id();
  const email = `mp.${displayName.toLowerCase().replace(/\W+/g, "")}.${RUN}.${userId.slice(0, 4)}@example.com`;
  await db.insert(schema.users).values({ id: userId, email, displayName, ageBracket: "18_plus", ageAttestedAt: at });
  await db.insert(schema.consentEvents).values(
    (["terms", "privacy"] as const).map((document) => ({
      userId,
      document,
      version: LEGAL[document].version,
      acceptedAt: at,
      method: "signup" as const,
    })),
  );
  return { id: userId, email, name: displayName };
}
type Person = Awaited<ReturnType<typeof person>>;

// Owner, admin and two plain members, in a weekly club.
async function club(name: string) {
  const [owner, admin, mia, max] = await Promise.all([person("Olga"), person("Adam"), person("Mia"), person("Max")]);
  const clubId = id();
  const clubName = `${name} ${RUN}`;
  await db.insert(schema.clubs).values({
    id: clubId,
    name: clubName,
    cadence: "weekly",
    defaultDay: 6,
    defaultTime: "20:00",
    timezone: "America/New_York",
    mode: "in_person",
    settings: { nomineesPerTurn: 3, confirmAt: "same_night", lockTime: 24, autoAdvance: 48, showVoteCounts: false },
  });
  const m = { owner: id(), admin: id(), mia: id(), max: id() };
  await db.insert(schema.memberships).values([
    { id: m.owner, clubId, userId: owner.id, role: "owner", joinedAt: new Date(Date.UTC(2026, 10, 7, 17)) },
    { id: m.admin, clubId, userId: admin.id, role: "admin", joinedAt: new Date(Date.UTC(2026, 10, 8, 17)) },
    { id: m.mia, clubId, userId: mia.id, role: "member", joinedAt: new Date(Date.UTC(2026, 10, 9, 17)) },
    { id: m.max, clubId, userId: max.id, role: "member", joinedAt: new Date(Date.UTC(2026, 10, 10, 17)) },
  ]);
  return { id: clubId, name: clubName, people: { owner, admin, mia, max }, m };
}

const url = (clubId: string, path = "") => `/clubs/${clubId}/members${path}`;
const card = (page: Page, heading: string) =>
  page.locator("main section").filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
const membershipOf = async (membershipId: string) =>
  (await db.select().from(schema.memberships).where(eq(schema.memberships.id, membershipId)))[0];
const clubRow = async (clubId: string) => (await db.select().from(schema.clubs).where(eq(schema.clubs.id, clubId)))[0];

async function as(browser: Browser, who: Person) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAsUser(page, who.id);
  return { context, page };
}

async function height(locator: Locator) {
  return (await locator.boundingBox())!.height;
}

test.describe("Members (u6)", () => {
  test("what each role sees: the owner everything, an admin ⋯ only on plain members, a plain member People, Just for you and Leave", async ({
    browser,
  }) => {
    const c = await club("Who Sees Club");
    await db.insert(schema.invites).values({ clubId: c.id, token: id(), inviteeName: "Ivy", invitedByMembershipId: c.m.owner });

    const o = await as(browser, c.people.owner);
    await o.page.goto(url(c.id));
    await expect(o.page.getByRole("heading", { name: "People · 4 of 6" })).toBeVisible();
    await expect(o.page.locator(".people-list .person-row").first()).toContainText("Olga (you)Owner");
    for (const name of ["Adam", "Mia", "Max"]) await expect(o.page.getByRole("link", { name: `Manage ${name}` })).toBeVisible();
    await expect(o.page.getByRole("link", { name: "Manage Olga" })).toHaveCount(0);
    await expect(o.page.getByRole("link", { name: "+ Invite" })).toHaveAttribute("href", url(c.id, "/invite"));
    await expect(o.page.locator(".invited-row")).toHaveText("Invited: Ivy · not started yet›");
    await expect(card(o.page, "Just for you")).toContainText("Your limitsNone set");
    await expect(card(o.page, "Club settings")).toContainText("How this club runsWeekly · Sat 8:00pm · 3 films");
    await expect(card(o.page, "Club settings")).toContainText("Club codeOff");
    await expect(card(o.page, "Club settings")).toContainText("Pause the clubRunning");
    await expect(o.page.getByRole("link", { name: "Leave this club" })).toHaveClass(/danger/);
    // Nothing inline any more: roles and removal are on each person's page.
    await expect(o.page.getByRole("button", { name: /Make .* admin|Remove/ })).toHaveCount(0);
    // The ⋯ is a 44px target.
    expect(await height(o.page.getByRole("link", { name: "Manage Mia" }))).toBeGreaterThanOrEqual(44);
    await o.context.close();

    const a = await as(browser, c.people.admin);
    await a.page.goto(url(c.id));
    await expect(a.page.getByRole("link", { name: "Manage Mia" })).toBeVisible();
    await expect(a.page.getByRole("link", { name: "Manage Olga" })).toHaveCount(0);
    await expect(a.page.getByRole("link", { name: "Manage Adam" })).toHaveCount(0);
    await expect(card(a.page, "Club settings")).toBeVisible();
    // An admin may only remove a plain member: no Role card there.
    await a.page.goto(url(c.id, `/${c.m.mia}`));
    await expect(a.page.getByRole("heading", { name: "Role" })).toHaveCount(0);
    await expect(a.page.getByRole("link", { name: "Remove Mia" })).toBeVisible();
    // Nobody they may act on: a 404.
    expect((await a.page.request.get(url(c.id, `/${c.m.owner}`))).status()).toBe(404);
    await a.context.close();

    const p = await as(browser, c.people.mia);
    await p.page.goto(url(c.id));
    await expect(p.page.locator(".people-list .person-row")).toHaveCount(4);
    await expect(p.page.locator(".manage-link")).toHaveCount(0);
    await expect(p.page.getByRole("link", { name: "+ Invite" })).toHaveCount(0);
    await expect(p.page.locator(".invited-row")).toHaveText("Invited: Ivy · not started yet");
    await expect(card(p.page, "Just for you")).toBeVisible();
    await expect(p.page.getByRole("heading", { name: "Club settings" })).toHaveCount(0);
    await expect(p.page.getByRole("heading", { name: "Asking to join" })).toHaveCount(0);
    await expect(p.page.getByRole("link", { name: "Leave this club" })).toBeVisible();
    // Everyone sees how the club runs (ruled 2026-11-10), in their own Club card.
    await expect(card(p.page, "Club")).toContainText("How this club runsWeekly · Sat 8:00pm · 3 films");
    for (const path of ["/settings/pause", `/${c.m.max}`, `/${c.m.owner}`]) {
      expect((await p.page.request.get(url(c.id, path))).status(), path).toBe(404);
    }
    await p.context.close();
  });

  test("on a laptop: two columns, the right one in place of the rail", async ({ browser }) => {
    const c = await club("Columns Club");
    const o = await as(browser, c.people.owner);
    await o.page.setViewportSize({ width: 1280, height: 900 });
    await o.page.goto(url(c.id));
    const people = await o.page.locator(".people-card").boundingBox();
    const forYou = await o.page.locator(".just-for-you").boundingBox();
    expect(forYou!.x).toBeGreaterThan(people!.x + people!.width - 1);
    await expect(o.page.locator(".rail")).toHaveCount(0);
    await o.page.setViewportSize({ width: 375, height: 900 });
    const narrowPeople = await o.page.locator(".people-card").boundingBox();
    const narrowForYou = await o.page.locator(".just-for-you").boundingBox();
    expect(narrowForYou!.y).toBeGreaterThan(narrowPeople!.y);
    await o.context.close();
  });

  test("a person's page: only allowed actions, each through its confirm", async ({ browser }) => {
    const c = await club("Manage Club");
    const o = await as(browser, c.people.owner);
    const urls = recordRequestUrls(o.page);
    await o.page.goto(url(c.id));
    await o.page.getByRole("link", { name: "Manage Mia" }).click();
    await expect(o.page).toHaveURL(url(c.id, `/${c.m.mia}`));
    await expect(o.page.locator(".page-title")).toHaveText("Mia");
    await expect(o.page.locator(".person-meta")).toHaveText("Member · joined Nov 9");
    await expect(o.page.getByRole("link", { name: "Members" }).first()).toHaveAttribute("href", url(c.id));

    await o.page.getByRole("button", { name: "Make Mia an admin" }).click();
    await expect(o.page.getByRole("status")).toHaveText("Saved.");
    expect((await membershipOf(c.m.mia)).role).toBe("admin");
    await o.page.getByRole("button", { name: "Remove Mia as admin" }).click();
    await expect(o.page.getByRole("button", { name: "Make Mia an admin" })).toBeVisible();
    expect((await membershipOf(c.m.mia)).role).toBe("member");

    await o.page.getByRole("link", { name: "Remove Mia" }).click();
    await expect(o.page.locator(".remove-confirm")).toContainText("Remove Mia from");
    await o.page.locator(".remove-confirm").getByRole("link", { name: "Cancel" }).click();
    await expect(o.page.locator(".remove-confirm")).toHaveCount(0);
    expect((await membershipOf(c.m.mia)).leftAt).toBeNull();
    await o.page.getByRole("link", { name: "Remove Mia" }).click();
    await o.page.locator(".remove-confirm").getByRole("button", { name: "Remove" }).click();
    await expect(o.page).toHaveURL(url(c.id, "?removed=1"));
    await expect(o.page.getByRole("status")).toHaveText("Removed.");
    expect((await membershipOf(c.m.mia)).leftAt).not.toBeNull();

    await o.page.goto(url(c.id, `/${c.m.max}`));
    await expect(o.page.getByText("Handing over makes Max the owner and you an admin. You'll confirm first.")).toBeVisible();
    await o.page.getByRole("link", { name: "Hand the club over to Max" }).click();
    await o.page.locator(".transfer-confirm").getByRole("button", { name: "Make owner" }).click();
    await expect(o.page).toHaveURL(url(c.id, "?roles=transferred"));
    await expect(o.page.getByRole("status")).toHaveText("Done. You're an admin now.");
    expect([(await membershipOf(c.m.max)).role, (await membershipOf(c.m.owner)).role]).toEqual(["owner", "admin"]);
    expectNoneContain(urls, "Mia", "Max", c.people.mia.email);

    // An old link to the single page's confirm lands on the person's page.
    await o.page.goto(url(c.id, `?remove=${c.m.admin}`));
    expect(new URL(o.page.url()).pathname).toBe(url(c.id, `/${c.m.admin}`));
    await o.context.close();
  });

  test("asking to join: the card, the badge, Let them in and Decline", async ({ browser }) => {
    const c = await club("Asking Club");
    const [ana, ben] = await Promise.all([person("Ana"), person("Ben")]);
    await db.insert(schema.joinRequests).values([
      { clubId: c.id, userId: ana.id, createdAt: new Date(Date.now() - 2 * 3600_000) },
      { clubId: c.id, userId: ben.id, createdAt: new Date(Date.now() - 3600_000) },
    ]);
    const a = await as(browser, c.people.admin);
    await a.page.goto(url(c.id));
    await expect(a.page.getByRole("link", { name: "Members, 2 asking to join" })).toBeVisible();
    const rows = a.page.locator(".asking-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("AnaUsed the club code · 2 hours ago");
    // One filled button on the page: the first request's.
    await expect(a.page.locator("main .btn.primary:visible")).toHaveCount(1);
    await expect(a.page.getByRole("button", { name: "Let Ana in" })).toHaveClass(/primary/);
    await a.page.getByRole("button", { name: "Let Ana in" }).click();
    await expect(a.page.getByRole("status")).toContainText("They're in.");
    await expect(a.page.getByRole("link", { name: "Members, 1 asking to join" })).toBeVisible();
    await a.page.getByRole("button", { name: "Decline Ben" }).click();
    await expect(a.page.getByRole("status")).toContainText("Declined.");
    await expect(a.page.locator(".tab-badge")).toHaveCount(0);
    const statuses = await db.select().from(schema.joinRequests).where(eq(schema.joinRequests.clubId, c.id));
    expect(statuses.map((r) => r.status).sort()).toEqual(["approved", "declined"]);
    await a.context.close();
  });

  test("your limits: Never and Rather not, the two-Never cap, remove, the switch", async ({ browser }) => {
    const c = await club("Limits Club");
    const p = await as(browser, c.people.mia);
    await p.page.goto(url(c.id));
    await p.page.getByRole("link", { name: /Your limits/ }).click();
    await expect(p.page).toHaveURL(url(c.id, "/limits"));
    await expect(p.page.locator(".page-title")).toHaveText(`Your limits in ${c.name}`);
    await expect(p.page.locator(".lock-line")).toHaveText("🔒 Only you see these. Nobody is told why a film is missing.");
    await expect(p.page.getByText("Those films never come up. 0 of 2 used.")).toBeVisible();
    await expect(p.page.getByText("Only a gentle warning.")).toBeVisible();

    const add = async (kind: "Never" | "Rather not", genre: string) => {
      await p.page.locator(".choice-card").filter({ hasText: kind }).click();
      await p.page.getByRole("radio", { name: "A genre" }).check();
      await p.page.locator('select[name="genre"]').selectOption({ label: genre });
      await p.page.getByRole("button", { name: "Add limit" }).click();
      await expect(p.page.getByRole("status")).toHaveText("Saved.");
    };
    await add("Never", "Horror");
    await expect(p.page.locator(".limit-card").first()).toContainText("NeverHorror");
    await add("Never", "War");
    await expect(p.page.getByText("Those films never come up. 2 of 2 used.")).toBeVisible();
    await expect(p.page.getByRole("radio", { name: /Never/ })).toBeDisabled();
    await expect(p.page.locator(".limit-cap")).toHaveText("You've used both Nevers. Remove one, or choose Rather not.");
    // A forged third Never is refused by the server, with the same words.
    await p.page.getByRole("radio", { name: /Never/ }).evaluate((el) => {
      (el as HTMLInputElement).disabled = false;
      (el as HTMLInputElement).checked = true;
    });
    await p.page.locator('select[name="genre"]').selectOption({ label: "Western" });
    await p.page.getByRole("button", { name: "Add limit" }).click();
    await expect(p.page.locator("main").getByRole("alert")).toHaveText("You've used both Nevers. Remove one, or choose Rather not.");
    await add("Rather not", "Romance");
    await expect(p.page.locator(".limit-card")).toHaveCount(3);
    for (const words of ["NeverHorror", "NeverWar", "Rather notRomance"]) {
      await expect(p.page.locator(".limit-card", { hasText: words })).toHaveCount(1);
    }

    await p.page.goto(url(c.id));
    await expect(card(p.page, "Just for you")).toContainText("2 never · 1 rather not");
    await p.page.goto(url(c.id, "/limits"));
    await p.page.getByRole("button", { name: "Remove Never: War" }).click();
    await expect(p.page.locator(".limit-card")).toHaveCount(2);

    const toggle = p.page.getByRole("switch", { name: "Also on weeks I'm not coming" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(p.page.getByText("Off: your limits only apply when you might be there.")).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    const rows = await db.select().from(schema.constraints).where(eq(schema.constraints.membershipId, c.m.mia));
    expect(rows.every((r) => r.appliesWhenAbsent)).toBe(true);
    // Nobody else sees any of it.
    const o = await as(browser, c.people.owner);
    await o.page.goto(url(c.id));
    await expect(card(o.page, "Just for you")).toContainText("None set");
    await expect(o.page.locator("main")).not.toContainText("Horror");
    await o.context.close();
    await p.context.close();
  });

  test("how the club runs: each group edits and saves alone; a mistake comes back as typed", async ({ browser }) => {
    const c = await club("Runs Club");
    const o = await as(browser, c.people.owner);
    const urls = recordRequestUrls(o.page);
    await o.page.goto(url(c.id));
    await o.page.getByRole("link", { name: /How this club runs/ }).click();
    await expect(o.page.locator(".page-title")).toHaveText(`How ${c.name} runs`);
    await expect(o.page.getByText("Changes apply from the next night. A night already under way keeps its plan.")).toBeVisible();
    await expect(o.page.locator(".club-values")).toHaveText(`Name${c.name}WhenWeekly, Saturdays at 8:00pmTime zoneAmerica/New_YorkWhereIn person`);
    // Only the code switch is a form until a group is edited.
    await expect(o.page.locator("main form")).toHaveCount(1);

    // Voting alone: only its form opens, and saving leaves the rest alone.
    await o.page.getByRole("link", { name: "Edit voting" }).click();
    await expect(o.page).toHaveURL(url(c.id, "/settings?edit=voting#voting"));
    await expect(o.page.locator(".voting-form")).toBeVisible();
    await expect(o.page.locator(".club-details-form, .after-form")).toHaveCount(0);
    await o.page.getByLabel("Films each picker offers").fill("2");
    await o.page.getByLabel("Show vote counts while voting is open").check();
    await o.page.getByRole("button", { name: "Save" }).click();
    await expect(o.page.getByRole("status")).toContainText("Saved.");
    await expect(o.page.locator(".voting-values")).toContainText("Films each picker offers2");
    expect((await clubRow(c.id)).settings).toEqual({
      nomineesPerTurn: 2,
      confirmAt: "same_night",
      lockTime: 24,
      autoAdvance: 48,
      showVoteCounts: true,
    });

    // After the night alone: vote counts stay on.
    await o.page.getByRole("link", { name: "Edit after the night" }).click();
    await o.page.getByLabel(/When to ask/).selectOption("manual_only");
    await o.page.getByRole("button", { name: "Save" }).click();
    await expect(o.page.locator(".after-values")).toContainText("Any time, even before the night");
    expect((await clubRow(c.id)).settings).toMatchObject({ nomineesPerTurn: 2, showVoteCounts: true, confirmAt: "manual_only" });

    // Cancel leaves everything.
    await o.page.getByRole("link", { name: "Edit voting" }).click();
    await o.page.getByRole("link", { name: "Cancel" }).click();
    await expect(o.page.locator(".voting-form")).toHaveCount(0);

    // The club: a mistake comes back with what was typed, never in the URL.
    await o.page.getByRole("link", { name: "Edit the club" }).click();
    await o.page.getByLabel("Club name").fill(`Renamed ${RUN}`);
    await o.page.getByLabel("Timezone").fill("Mars/Olympus");
    await o.page.locator("form.club-details-form").evaluate((f) => f.setAttribute("novalidate", ""));
    await o.page.getByRole("button", { name: "Save" }).click();
    await expect(o.page.locator("main").getByRole("alert")).toHaveText('"Mars/Olympus" isn\'t a recognized timezone, e.g. "America/New_York".');
    await expect(o.page.getByLabel("Club name")).toHaveValue(`Renamed ${RUN}`);
    await expect(o.page.getByLabel("Timezone")).toHaveValue("Mars/Olympus");
    expect((await clubRow(c.id)).name).toBe(c.name);
    await o.page.getByLabel("Timezone").fill("America/Chicago");
    await o.page.getByRole("button", { name: "Save" }).click();
    await expect(o.page.locator(".club-values")).toContainText(`Renamed ${RUN}`);
    const after = await clubRow(c.id);
    expect([after.name, after.timezone]).toEqual([`Renamed ${RUN}`, "America/Chicago"]);
    expect(after.settings).toMatchObject({ nomineesPerTurn: 2, showVoteCounts: true, confirmAt: "manual_only" });
    // The club's new name never rode in a URL. (The time zone error quotes
    // the zone typed in ?detailsError=, as before u6: not personal,
    // lib/clubDetails.ts.)
    expectNoneContain(urls, `Renamed ${RUN}`);
    await o.context.close();
  });

  test("a plain member sees how the club runs, read-only: no Edit, no code, no Pause; a forged edit is refused", async ({
    browser,
  }) => {
    const c = await club("Read Only Club");
    // Codes are unique across clubs: a fresh one, never a fixed string.
    const code = generateJoinCode();
    await db.update(schema.clubs).set({ joinCode: code }).where(eq(schema.clubs.id, c.id));
    const p = await as(browser, c.people.mia);
    await p.page.goto(url(c.id));
    await p.page.getByRole("link", { name: /How this club runs/ }).click();
    await expect(p.page).toHaveURL(url(c.id, "/settings"));
    await expect(p.page.locator(".page-title")).toHaveText(`How ${c.name} runs`);
    await expect(p.page.locator(".club-values")).toContainText("WhenWeekly, Saturdays at 8:00pm");
    await expect(p.page.locator(".voting-values")).toContainText("Films each picker offers3");
    await expect(p.page.locator(".after-values")).toContainText("When to ask “Did you watch it?”That night");
    await expect(p.page.getByRole("link", { name: /^Edit / })).toHaveCount(0);
    await expect(p.page.locator("#join-code")).toHaveCount(0);
    await expect(p.page.locator("main")).not.toContainText(code.slice(0, 4));
    await expect(p.page.getByRole("link", { name: /Pause the club/ })).toHaveCount(0);
    await expect(p.page.locator("main form")).toHaveCount(0);
    // ?edit= opens nothing for them.
    for (const edit of ["club", "voting", "after"]) {
      await p.page.goto(url(c.id, `/settings?edit=${edit}`));
      await expect(p.page.locator("main form"), edit).toHaveCount(0);
    }
    await p.context.close();

    // A forged edit: the admin's own form, submitted after they're made a
    // plain member, as a stale or forged post arrives. Refused, unchanged.
    const a = await as(browser, c.people.admin);
    await a.page.goto(url(c.id, "/settings?edit=voting"));
    await a.page.getByLabel("Films each picker offers").fill("1");
    await db.update(schema.memberships).set({ role: "member" }).where(eq(schema.memberships.id, c.m.admin));
    const response = a.page.waitForResponse((r) => r.request().method() === "POST");
    await a.page.getByRole("button", { name: "Save", exact: true }).click();
    expect((await response).status()).toBe(500);
    expect((await clubRow(c.id)).settings).toMatchObject({ nomineesPerTurn: 3 });
    await a.context.close();
  });

  test("the club code card and pausing, from the settings page", async ({ browser }) => {
    const c = await club("Code Pause Club");
    const a = await as(browser, c.people.admin);
    await a.page.goto(url(c.id));
    await a.page.getByRole("link", { name: /Club code/ }).click();
    await expect(a.page).toHaveURL(url(c.id, "/settings#join-code"));
    const toggle = a.page.getByRole("switch", { name: "Let people ask to join with a code" });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(a.page.getByText("Anyone with the code can ask to join. Nobody gets in until you or an admin says yes.")).toBeVisible();
    const first = await a.page.getByLabel(`Club code for ${c.name}`).inputValue();
    await a.context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await a.page.getByRole("button", { name: "Copy" }).click();
    expect(await a.page.evaluate(() => navigator.clipboard.readText())).toBe(first);
    await a.page.getByRole("button", { name: "Make a new code (the old one stops working)" }).click();
    await expect(a.page.getByLabel(`Club code for ${c.name}`)).not.toHaveValue(first);
    await a.page.goto(url(c.id));
    await expect(card(a.page, "Club settings")).toContainText(/Club codeOn · [0-9A-Z]{4}-[0-9A-Z]{4}/);

    await a.page.getByRole("link", { name: /Pause the club/ }).click();
    await expect(a.page.locator(".page-title")).toHaveText(`Pause ${c.name}`);
    await expect(a.page.locator(".pause-explain")).toContainText("A night already under way carries on.");
    await a.page.getByRole("button", { name: "Pause the club" }).click();
    await expect(a.page.getByRole("status")).toContainText("Paused.");
    expect((await clubRow(c.id)).pausedAt).not.toBeNull();
    await a.page.goto(url(c.id));
    await expect(card(a.page, "Club settings")).toContainText("Pause the clubPaused");
    await a.page.goto(url(c.id, "/settings/pause"));
    await a.page.getByRole("button", { name: "Resume the club" }).click();
    await expect(a.page.getByRole("status")).toContainText("Running again.");
    expect((await clubRow(c.id)).pausedAt).toBeNull();
    await a.context.close();
  });

  test("leave: the danger button, then the same two-tap leave", async ({ browser }) => {
    const c = await club("Leave Club");
    const p = await as(browser, c.people.max);
    await p.page.goto(url(c.id));
    await p.page.getByRole("link", { name: "Leave this club" }).click();
    await expect(p.page.locator(".leave-confirm")).toContainText(`Leave ${c.name}? Your past picks, votes and ratings stay in its history.`);
    await p.page.locator(".leave-confirm").getByRole("button", { name: "Leave" }).click();
    await expect(p.page).toHaveURL("/");
    expect((await membershipOf(c.m.max)).leftAt).not.toBeNull();
    await p.context.close();
  });

  test("old links into the single page land on the new pages", async ({ browser }) => {
    const c = await club("Old Links Club");
    const o = await as(browser, c.people.owner);
    for (const [hash, path] of [
      ["#limits", "/limits"],
      ["#club-settings", "/settings"],
      ["#club-details", "/settings"],
      ["#join-code", "/settings"],
      ["#add-person", "/invite"],
    ]) {
      await o.page.goto(url(c.id, hash));
      await expect(o.page, hash).toHaveURL(new RegExp(`${url(c.id, path).replace(/[/]/g, "\\/")}(#.*)?$`));
    }
    await o.page.goto(url(c.id, `?transfer=${c.m.mia}`));
    await expect(o.page.locator(".transfer-confirm")).toContainText("Make Mia the owner");
    await o.context.close();
    expect(await db.select().from(schema.memberships).where(and(eq(schema.memberships.clubId, c.id), isNull(schema.memberships.leftAt)))).toHaveLength(4);
  });
});
