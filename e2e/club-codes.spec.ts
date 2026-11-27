import type { Browser, Page } from "@playwright/test";
import { neon } from "@neondatabase/serverless";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "../db/schema";
import { anonymiseAccount } from "../app/anonymise";
import { clubDeletionStatements } from "../app/clubDeletion";
import { approveJoinRequest, declineJoinRequest } from "../app/joinRequests";
import { runRetentionCleanup } from "../app/retentionCleanup";
import { formatJoinCode, generateJoinCode } from "../lib/joinCode";
import { LEGAL } from "../lib/legal";
import { expect, test } from "./fixtures";
import { EMAIL_OUTBOX_FILE, sentTo } from "./outbox";
import { signInAsUser } from "./session";

// Club codes: asking to join, with approval (u5, ruled 2026-11-25; details
// 2026-11-26). Builds its own people and clubs, so no seeded club changes.
// Fresh addresses per attempt (a retry runs in a new worker).

const db = drizzle(neon(process.env.E2E_DATABASE_URL!), { schema });
// The approvals this spec calls directly email from this process: into the
// same outbox the server writes (e2e/outbox.ts), never a real send.
process.env.EMAIL_OUTBOX_FILE ??= EMAIL_OUTBOX_FILE;
const id = () => crypto.randomUUID();
const RUN = id().slice(0, 8);
const at = new Date(Date.UTC(2026, 0, 1));
const DAY = 86_400_000;

async function person(displayName: string) {
  const userId = id();
  const email = `cc.${displayName.toLowerCase().replace(/\W+/g, "")}.${RUN}.${userId.slice(0, 4)}@example.com`;
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

// A club with its owner, and anyone else as admin or member. Ad hoc, so
// nothing drafts underneath the test.
async function club(name: string, owner: Person, others: { who: Person; role: "admin" | "member" }[] = []) {
  const clubId = id();
  await db.insert(schema.clubs).values({ id: clubId, name: `${name} ${RUN}`, cadence: "ad_hoc", timezone: "America/New_York", mode: "in_person" });
  const ownerMembership = id();
  await db.insert(schema.memberships).values([
    { id: ownerMembership, clubId, userId: owner.id, role: "owner", joinedAt: at },
    ...others.map((o, i) => ({ clubId, userId: o.who.id, role: o.role, joinedAt: new Date(at.getTime() + (i + 1) * 1000) })),
  ]);
  return { id: clubId, name: `${name} ${RUN}`, ownerMembership };
}

const membersUrl = (clubId: string) => `/clubs/${clubId}/members`;
const codeSwitch = (page: Page) => page.getByRole("switch", { name: "Let people ask to join with a code" });
const codeField = (page: Page, clubName: string) => page.getByLabel(`Club code for ${clubName}`);
const alert = (page: Page) => page.locator("main").getByRole("alert");

async function turnCodesOn(page: Page, clubId: string, clubName: string): Promise<string> {
  await page.goto(membersUrl(clubId));
  await codeSwitch(page).click();
  await expect(codeSwitch(page)).toHaveAttribute("aria-checked", "true");
  return codeField(page, clubName).inputValue();
}

async function enterCode(page: Page, code: string) {
  await page.goto("/join");
  await page.getByLabel("Club code").fill(code);
  await page.getByRole("button", { name: "Ask to join", exact: true }).click();
}

async function askToJoin(page: Page, code: string, clubName: string) {
  await enterCode(page, code);
  await page.getByRole("button", { name: `Ask to join ${clubName}` }).click();
  await expect(page.locator(".request-sent")).toContainText(`Request sent to ${clubName}.`);
}

async function asUser(browser: Browser, who: Person) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAsUser(page, who.id);
  return { context, page };
}

const requestsOf = (userId: string) =>
  db.select().from(schema.joinRequests).where(eq(schema.joinRequests.userId, userId));
const activeMembership = async (clubId: string, userId: string) =>
  (
    await db
      .select()
      .from(schema.memberships)
      .where(and(eq(schema.memberships.clubId, clubId), eq(schema.memberships.userId, userId), isNull(schema.memberships.leftAt)))
  )[0] ?? null;

test.describe("club codes", () => {
  test("the owner turns codes on, copies the code, makes a new one; the old one stops working at once", async ({
    page,
    browser,
  }) => {
    const owner = await person("Ora");
    const c = await club("Code Club", owner);
    await signInAsUser(page, owner.id);
    await page.goto(membersUrl(c.id));
    // Off by default: no code anywhere.
    await expect(codeSwitch(page)).toHaveAttribute("aria-checked", "false");
    await expect(codeField(page, c.name)).toHaveCount(0);
    expect((await db.select().from(schema.clubs).where(eq(schema.clubs.id, c.id)))[0].joinCode).toBeNull();

    const first = await turnCodesOn(page, c.id, c.name);
    expect(first).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Copy" }).click();
    await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(first);

    await page.getByRole("button", { name: "Make a new code" }).click();
    await expect(page.getByText("New code made. The old one doesn't work any more.")).toBeVisible();
    const second = await codeField(page, c.name).inputValue();
    expect(second).not.toBe(first);

    const asker = await person("Abe");
    const a = await asUser(browser, asker);
    await enterCode(a.page, first);
    await expect(alert(a.page)).toHaveText("That code didn't work. Check it with someone in the club.");
    await enterCode(a.page, second);
    await expect(a.page.locator(".confirm-club-name")).toHaveText(c.name);
    await a.context.close();
  });

  test("a member of another club asks with spaced, lower-case input; the confirm step shows only the club's name", async ({
    page,
    browser,
  }) => {
    const owner = await person("Pia");
    const c = await club("Ask Club", owner);
    await signInAsUser(page, owner.id);
    const code = await turnCodesOn(page, c.id, c.name);
    const asker = await person("Ben");
    await club("Ben Home Club", asker);
    const urls: string[] = [];
    const a = await asUser(browser, asker);
    a.page.on("request", (r) => urls.push(r.url()));

    await a.page.goto("/join");
    await expect(a.page.getByRole("heading", { level: 1 })).toHaveText("Join a friend's club");
    await expect(a.page.getByText("Clubs are private, so they can't be searched. Ask someone in the club for its code.")).toBeVisible();
    await expect(a.page.getByText("Got a personal invite link instead? Just open it.")).toBeVisible();
    await expect(a.page.getByText("Nobody joins without the club saying yes.")).toBeVisible();
    await expect(a.page.getByText("Only your display name is shared with them until you're in.")).toBeVisible();
    // Sign-up is closed on this server: no "Start your own".
    await expect(a.page.getByRole("link", { name: "Start your own" })).toHaveCount(0);

    const typed = ` ${code.slice(0, 2).toLowerCase()} ${code.slice(2, 4)}${code.slice(5).toLowerCase()} `;
    await a.page.getByLabel("Club code").fill(typed);
    await a.page.getByRole("button", { name: "Ask to join", exact: true }).click();
    await expect(a.page).toHaveURL("/join?confirm=1");
    // The club's name and nothing else about it.
    await expect(a.page.locator(".confirm-club")).toHaveText(
      `Club code ${code}${c.name}Ask to join ${c.name}Not this club? Try another code`,
    );
    await a.page.getByRole("button", { name: `Ask to join ${c.name}` }).click();
    await expect(a.page.locator(".request-sent")).toHaveText(
      `Request sent to ${c.name}.The club's owner or an admin will let you in. We'll email you when they do.Cancel request`,
    );
    expect((await requestsOf(asker.id)).map((r) => [r.clubId, r.status])).toEqual([[c.id, "pending"]]);
    // The code never rides in a URL.
    const bare = code.replace("-", "");
    expect(urls.filter((u) => u.toUpperCase().includes(bare) || u.toUpperCase().includes(code))).toEqual([]);
    // Asking again is refused: one request per club at a time.
    await enterCode(a.page, code);
    await a.page.getByRole("button", { name: `Ask to join ${c.name}` }).click();
    await expect(alert(a.page)).toHaveText(`You've already asked to join ${c.name}.`);
    await a.context.close();
  });

  test("owners and admins see who's asking, with a badge on Members; plain members see no code, no requests, no badge", async ({
    page,
    browser,
  }) => {
    const owner = await person("Quin");
    const admin = await person("Ada");
    const plain = await person("Max");
    const c = await club("Badge Club", owner, [
      { who: admin, role: "admin" },
      { who: plain, role: "member" },
    ]);
    await signInAsUser(page, owner.id);
    const code = await turnCodesOn(page, c.id, c.name);
    const asker = await person("Cora");
    const a = await asUser(browser, asker);
    await askToJoin(a.page, code, c.name);
    await a.context.close();

    for (const viewer of [owner, admin]) {
      const v = await asUser(browser, viewer);
      await v.page.goto(`/clubs/${c.id}`);
      await expect(v.page.getByRole("navigation", { name: "Club" }).getByRole("link", { name: "Members, 1 asking to join" })).toBeVisible();
      await v.page.goto(membersUrl(c.id));
      const list = v.page.locator(".asking-list li");
      await expect(list).toHaveCount(1);
      await expect(list.first()).toContainText("Cora");
      await expect(list.first()).toContainText("just now");
      // Only the display name: no email.
      await expect(list.first()).not.toContainText("@");
      await v.context.close();
    }

    const m = await asUser(browser, plain);
    await m.page.goto(membersUrl(c.id));
    await expect(m.page.getByRole("navigation", { name: "Club" }).getByRole("link", { name: "Members", exact: true })).toBeVisible();
    await expect(m.page.locator("#asking, #join-code, .tab-badge")).toHaveCount(0);
    await expect(m.page.locator("main")).not.toContainText(code);
    await expect(m.page.locator("main")).not.toContainText("Cora");
    await m.context.close();
  });

  test("approve: they're in, with the approver as provenance, and emailed; one link, nothing else", async ({ page, browser }) => {
    const owner = await person("Rhea");
    const c = await club("Approve Club", owner);
    await signInAsUser(page, owner.id);
    const code = await turnCodesOn(page, c.id, c.name);
    const asker = await person("Dev");
    const a = await asUser(browser, asker);
    await askToJoin(a.page, code, c.name);

    await page.goto(membersUrl(c.id));
    await page.getByRole("button", { name: "Approve Dev" }).click();
    await expect(page.getByRole("status")).toContainText("They're in. We've emailed them.");
    const joined = await activeMembership(c.id, asker.id);
    expect(joined).toMatchObject({ role: "member", approvedByMembershipId: c.ownerMembership });
    const [request] = await requestsOf(asker.id);
    expect(request).toMatchObject({ status: "approved", decidedByMembershipId: c.ownerMembership });
    expect(request.decidedAt).not.toBeNull();

    const mail = sentTo(asker.email).filter((m) => m.kind === "join-approved");
    expect(mail).toHaveLength(1);
    expect(mail[0].subject).toBe(`You're in ${c.name}`);
    expect(mail[0].html.match(/<a /g)).toHaveLength(1);
    expect(mail[0].html).toContain(`/clubs/${c.id}"`);
    expect(mail[0].html).not.toContain("Rhea");
    // No email to approvers, ever: not when asked, not when approved.
    expect(sentTo(owner.email)).toEqual([]);
    // Not a reminder: nothing in the reminder log.
    expect(await db.select().from(schema.notificationLog).where(eq(schema.notificationLog.userId, asker.id))).toEqual([]);

    await a.page.goto("/");
    await expect(a.page.locator("main a.clubcard")).toContainText([c.name]);
    // And /join for that club now says they're in.
    await enterCode(a.page, code);
    await expect(a.page.getByRole("heading", { name: `You're already in ${c.name}` })).toBeVisible();
    await expect(a.page.getByRole("link", { name: `Go to ${c.name}` })).toHaveAttribute("href", `/clubs/${c.id}`);
    await a.context.close();
  });

  test("approve is refused when the club is full (pending invites hold seats) or the name is taken; the request stays pending", async ({
    page,
    browser,
  }) => {
    const owner = await person("Sol");
    const four = await Promise.all(["Tam", "Uma", "Vic", "Wes"].map((n) => person(n)));
    const c = await club("Full Club", owner, four.map((who) => ({ who, role: "member" as const })));
    await db.insert(schema.invites).values({ clubId: c.id, token: id(), inviteeName: "Xan", invitedByMembershipId: c.ownerMembership });
    await signInAsUser(page, owner.id);
    const code = await turnCodesOn(page, c.id, c.name);
    const asker = await person("Yan");
    const a = await asUser(browser, asker);
    await askToJoin(a.page, code, c.name);

    await page.goto(membersUrl(c.id));
    await page.getByRole("button", { name: "Approve Yan" }).click();
    await expect(alert(page)).toHaveText(`${c.name} is full. Free a seat to let them in.`);
    expect(page.url()).not.toContain("Yan");
    expect(await activeMembership(c.id, asker.id)).toBeNull();
    expect((await requestsOf(asker.id))[0].status).toBe("pending");

    // A seat frees (the invite revoked), but someone already goes by Tam.
    await db.update(schema.invites).set({ revokedAt: new Date() }).where(eq(schema.invites.clubId, c.id));
    const clash = await person("tam");
    const b = await asUser(browser, clash);
    await askToJoin(b.page, code, c.name);
    await page.goto(membersUrl(c.id));
    await page.getByRole("button", { name: "Approve tam" }).click();
    await expect(alert(page)).toHaveText(`Someone in ${c.name} already goes by tam.`);
    expect(page.url()).not.toMatch(/tam/i);
    expect(await activeMembership(c.id, clash.id)).toBeNull();
    expect((await requestsOf(clash.id))[0].status).toBe("pending");

    // Yan can be let in now.
    await page.getByRole("button", { name: "Approve Yan" }).click();
    await expect(page.getByRole("status")).toContainText("They're in.");
    expect(await activeMembership(c.id, asker.id)).not.toBeNull();
    await a.context.close();
    await b.context.close();
  });

  test("decline: no email; the requester sees it for 30 days and can't ask again until then", async ({ page, browser }) => {
    const owner = await person("Tia");
    const c = await club("Decline Club", owner);
    await signInAsUser(page, owner.id);
    const code = await turnCodesOn(page, c.id, c.name);
    const asker = await person("Eve");
    const a = await asUser(browser, asker);
    await askToJoin(a.page, code, c.name);

    await page.goto(membersUrl(c.id));
    await page.getByRole("button", { name: "Decline Eve" }).click();
    await expect(page.getByRole("status")).toContainText("Declined.");
    await expect(page.locator(".asking-list li")).toHaveCount(0);
    expect(sentTo(asker.email).filter((m) => m.kind === "join-approved")).toEqual([]);

    await a.page.goto("/join");
    await expect(a.page.locator(".declined-request")).toHaveText(`${c.name} didn't accept your request.`);
    await enterCode(a.page, code);
    await a.page.getByRole("button", { name: `Ask to join ${c.name}` }).click();
    await expect(alert(a.page)).toHaveText(`${c.name} didn't accept your request.`);

    // After 30 days: gone from the page, and asking again works.
    await db
      .update(schema.joinRequests)
      .set({ decidedAt: new Date(Date.now() - 31 * DAY) })
      .where(eq(schema.joinRequests.userId, asker.id));
    await a.page.goto("/join");
    await expect(a.page.locator(".declined-request")).toHaveCount(0);
    await askToJoin(a.page, code, c.name);
    await a.context.close();
  });

  test("cancel, and at most five waiting at once", async ({ page }) => {
    const asker = await person("Fin");
    await signInAsUser(page, asker.id);
    const clubs = [];
    for (let i = 0; i < 6; i++) {
      const owner = await person(`Own${i}`);
      const c = await club(`Many Club ${i}`, owner);
      const code = generateJoinCode();
      await db.update(schema.clubs).set({ joinCode: code }).where(eq(schema.clubs.id, c.id));
      clubs.push({ ...c, code: formatJoinCode(code) });
    }
    await askToJoin(page, clubs[0].code, clubs[0].name);
    await page.getByRole("button", { name: "Cancel request" }).click();
    await expect(page).toHaveURL("/join?cancelled=1");
    await expect(page.getByRole("status")).toHaveText("Request cancelled.");
    expect((await requestsOf(asker.id))[0].status).toBe("cancelled");

    for (const c of clubs.slice(0, 5)) await askToJoin(page, c.code, c.name);
    await enterCode(page, clubs[5].code);
    await page.getByRole("button", { name: `Ask to join ${clubs[5].name}` }).click();
    await expect(alert(page)).toHaveText("You have 5 requests waiting. Cancel one to ask another club.");
    // The page lists them, each with its own Cancel.
    await page.goto("/join");
    await expect(page.locator(".my-requests li")).toHaveCount(5);
    await page.getByRole("button", { name: `Cancel request to ${clubs[1].name}` }).click();
    await askToJoin(page, clubs[5].code, clubs[5].name);
  });

  test("ten wrong codes an hour, then even the right one is refused; a right code doesn't count", async ({ page }) => {
    const owner = await person("Gus");
    const c = await club("Limit Club", owner);
    await signInAsUser(page, owner.id);
    const code = await turnCodesOn(page, c.id, c.name);

    const asker = await person("Hal");
    await signInAsUser(page, asker.id);
    // A right one first: it gives its try back.
    await enterCode(page, code);
    await expect(page.locator(".confirm-club-name")).toHaveText(c.name);
    for (let i = 1; i <= 10; i++) {
      await enterCode(page, i === 10 ? "ZZZZ-ZZZZ" : `${String(i).padStart(4, "0")}-0000`);
      await expect(page).toHaveURL("/join?error=1");
      await expect(alert(page)).toHaveText("That code didn't work. Check it with someone in the club.");
    }
    await enterCode(page, code);
    await expect(alert(page)).toHaveText("Too many tries. Try again in an hour.");
    // An hour later it works again.
    await db
      .update(schema.joinCodeAttempts)
      .set({ createdAt: new Date(Date.now() - 61 * 60_000) })
      .where(eq(schema.joinCodeAttempts.userId, asker.id));
    await enterCode(page, code);
    await expect(page.locator(".confirm-club-name")).toHaveText(c.name);
  });

  test("two admins approving at once leave one membership; approving while another declines leaves one outcome", async () => {
    const owner = await person("Ivo");
    const admin = await person("Jem");
    const c = await club("Race Club", owner, [{ who: admin, role: "admin" }]);
    const [adminMembership] = await db
      .select()
      .from(schema.memberships)
      .where(and(eq(schema.memberships.clubId, c.id), eq(schema.memberships.userId, admin.id)));
    const origin = "http://localhost:3100";

    const asker = await person("Kai");
    const [r1] = await db.insert(schema.joinRequests).values({ clubId: c.id, userId: asker.id }).returning();
    const now = new Date();
    const both = await Promise.all([
      approveJoinRequest(db, c.ownerMembership, c.id, r1.id, origin, now),
      approveJoinRequest(db, adminMembership.id, c.id, r1.id, origin, now),
    ]);
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    const rows = await db
      .select()
      .from(schema.memberships)
      .where(and(eq(schema.memberships.clubId, c.id), eq(schema.memberships.userId, asker.id)));
    expect(rows).toHaveLength(1);
    const [decided] = await requestsOf(asker.id);
    expect(decided.status).toBe("approved");
    expect(rows[0].approvedByMembershipId).toBe(decided.decidedByMembershipId);
    expect(sentTo(asker.email).filter((m) => m.kind === "join-approved")).toHaveLength(1);

    const other = await person("Lev");
    const [r2] = await db.insert(schema.joinRequests).values({ clubId: c.id, userId: other.id }).returning();
    const later = new Date();
    await Promise.all([
      approveJoinRequest(db, c.ownerMembership, c.id, r2.id, origin, later),
      declineJoinRequest(db, adminMembership.id, c.id, r2.id, later),
    ]);
    const [outcome] = await requestsOf(other.id);
    const member = await activeMembership(c.id, other.id);
    expect(["approved", "declined"]).toContain(outcome.status);
    expect(member !== null).toBe(outcome.status === "approved");
  });

  test("turning codes off: the code stops working, pending requests can still be decided", async ({ page, browser }) => {
    const owner = await person("Mia");
    const c = await club("Off Switch Club", owner);
    await signInAsUser(page, owner.id);
    const code = await turnCodesOn(page, c.id, c.name);
    const asker = await person("Ned");
    const a = await asUser(browser, asker);
    await askToJoin(a.page, code, c.name);

    await page.goto(membersUrl(c.id));
    await codeSwitch(page).click();
    await expect(codeSwitch(page)).toHaveAttribute("aria-checked", "false");
    await expect(codeField(page, c.name)).toHaveCount(0);
    expect((await db.select().from(schema.clubs).where(eq(schema.clubs.id, c.id)))[0].joinCode).toBeNull();

    const late = await person("Oli");
    const b = await asUser(browser, late);
    await enterCode(b.page, code);
    await expect(alert(b.page)).toHaveText("That code didn't work. Check it with someone in the club.");
    await b.context.close();

    await page.getByRole("button", { name: "Approve Ned" }).click();
    await expect(page.getByRole("status")).toContainText("They're in.");
    expect(await activeMembership(c.id, asker.id)).not.toBeNull();
    await a.context.close();
  });

  test("export has your own requests; deleting the account or the club deletes them; leaving doesn't; retention", async ({
    page,
  }) => {
    const owner = await person("Pam");
    const c = await club("Life Club", owner);
    const c2 = await club("Life Two Club", owner);
    const asker = await person("Ray");
    await db.insert(schema.joinRequests).values([
      { clubId: c.id, userId: asker.id, status: "declined", decidedAt: new Date(), decidedByMembershipId: c.ownerMembership },
      { clubId: c2.id, userId: asker.id },
    ]);
    await signInAsUser(page, asker.id);
    const exported = await (await page.request.get("/settings/export")).json();
    expect(exported.requests_to_join).toEqual([
      expect.objectContaining({ club: c.name, status: "declined", decided_at: expect.any(String) }),
      expect.objectContaining({ club: c2.name, status: "pending", decided_at: null }),
    ]);
    expect(JSON.stringify(exported.requests_to_join)).not.toContain(owner.name);

    // Leaving a club doesn't touch requests.
    await db.update(schema.memberships).set({ leftAt: new Date() }).where(eq(schema.memberships.id, c.ownerMembership));
    expect(await requestsOf(asker.id)).toHaveLength(2);
    await db.update(schema.memberships).set({ leftAt: null }).where(eq(schema.memberships.id, c.ownerMembership));

    // Deleting the club deletes its requests.
    await db.batch(clubDeletionStatements(db, [c2.id]) as [BatchItem<"pg">, ...BatchItem<"pg">[]]);
    expect((await requestsOf(asker.id)).map((r) => r.clubId)).toEqual([c.id]);

    // Deleting the account deletes their requests and code tries.
    await db.insert(schema.joinCodeAttempts).values({ userId: asker.id });
    await anonymiseAccount(db, asker.id);
    expect(await requestsOf(asker.id)).toEqual([]);
    expect(await db.select().from(schema.joinCodeAttempts).where(eq(schema.joinCodeAttempts.userId, asker.id))).toEqual([]);

    // Retention: decided ones 90 days after the decision, pending after 30,
    // code tries after a day.
    const keeper = await person("Sky");
    const now = new Date();
    const ago = (days: number) => new Date(now.getTime() - days * DAY);
    const clubsForRetention = await Promise.all([0, 1, 2, 3].map((i) => club(`Keep Club ${i}`, owner)));
    await db.insert(schema.joinRequests).values([
      { clubId: clubsForRetention[0].id, userId: keeper.id, status: "declined", createdAt: ago(100), decidedAt: ago(91) },
      { clubId: clubsForRetention[1].id, userId: keeper.id, status: "cancelled", createdAt: ago(100), decidedAt: ago(89) },
      { clubId: clubsForRetention[2].id, userId: keeper.id, status: "pending", createdAt: ago(31) },
      { clubId: clubsForRetention[3].id, userId: keeper.id, status: "pending", createdAt: ago(29) },
    ]);
    await db.insert(schema.joinCodeAttempts).values([
      { userId: keeper.id, createdAt: ago(2) },
      { userId: keeper.id, createdAt: new Date(now.getTime() - 3600_000) },
    ]);
    await runRetentionCleanup(db, now);
    const left = await requestsOf(keeper.id);
    expect(left.map((r) => r.clubId).sort()).toEqual([clubsForRetention[1].id, clubsForRetention[3].id].sort());
    expect(await db.select().from(schema.joinCodeAttempts).where(eq(schema.joinCodeAttempts.userId, keeper.id))).toHaveLength(1);
  });

  test("signed out, /join goes to sign-in and back, which says a code needs an account", async ({ page }) => {
    await page.goto("/join");
    await expect(page).toHaveURL("/login?returnTo=%2Fjoin");
    await expect(page.locator(".join-needs-account")).toHaveText(
      "Sign in to join a club with its code. You need an account first, and Kinomato is invite-only for now: to make one, ask someone in a club for a personal invite link.",
    );
    await page.goto("/login");
    await expect(page.locator(".join-needs-account")).toHaveCount(0);
  });

  test("the ways in: /new and the empty Clubs page link to /join", async ({ page }) => {
    const nobody = await person("Tess");
    await signInAsUser(page, nobody.id);
    await page.goto("/");
    await page.getByRole("link", { name: "Join a club with a code" }).click();
    await expect(page).toHaveURL("/join");
    await page.goto("/new");
    await page.getByRole("link", { name: "Joining a friend's club instead?" }).click();
    await expect(page).toHaveURL("/join");
  });
});
