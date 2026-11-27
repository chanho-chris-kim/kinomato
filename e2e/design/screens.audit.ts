import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, type Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../db/schema";
import { hashToken } from "../../lib/authCredentials";
import { LEGAL } from "../../lib/legal";
import { signInAsUser } from "../session";
import { agreeToTerms, holdSignInAddress, setKnownSignIn } from "../signIn";

// Design screenshots (`npm run audit:screens`, e2e/design/audit.config.ts):
// every page in its real states, built on the E2E database, shot at 375
// and 1280 as <page>-<state>-<width>.png, with a few accessibility
// measurements per page in metrics.json. Not a test of behaviour: nothing
// here asserts, and the E2E run never picks it up.
//
// AUDIT_LABEL names the output folder (design-audit/<label>/, default
// "latest"), so a step shoots "before" and "after" and compares the pairs.
// The prototype's own screens go to design-audit/prototype/.

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "design-audit", process.env.AUDIT_LABEL || "latest");
const PROTOTYPE_OUT = path.join(ROOT, "design-audit", "prototype");
const client = postgres(process.env.E2E_DATABASE_URL!, { max: 1 });
const db = drizzle(client, { schema });
const id = () => crypto.randomUUID();
const H = 3600_000;
const NOW = new Date();
const at = (h: number) => new Date(NOW.getTime() + h * H);
const consentAt = new Date(Date.UTC(2026, 0, 1));
const metrics: Record<string, unknown> = {};

type Key = "ana" | "ben" | "cal" | "dee";
const U: Record<Key, string> = { ana: id(), ben: id(), cal: id(), dee: id() };
const NAMES: Record<Key, string> = { ana: "Ana A.", ben: "Ben B.", cal: "Cal C.", dee: "Dee D." };

async function user(key: string, userId: string, displayName: string | null, consent = true) {
  await db.insert(schema.users).values({
    id: userId,
    email: `${key}.audit.${userId.slice(0, 6)}@example.com`,
    displayName,
    ageBracket: consent ? "18_plus" : null,
    ageAttestedAt: consent ? consentAt : null,
  });
  if (consent) {
    await db.insert(schema.consentEvents).values(
      (["terms", "privacy"] as const).map((document) => ({
        userId,
        document,
        version: LEGAL[document].version,
        acceptedAt: consentAt,
        method: "signup" as const,
      })),
    );
  }
}

type Role = "owner" | "admin" | "member";
async function club(name: string, roles: Partial<Record<Key, Role>>, o: { paused?: boolean } = {}) {
  const clubId = id();
  await db.insert(schema.clubs).values({
    id: clubId,
    name,
    cadence: "weekly",
    defaultDay: 6,
    defaultTime: "20:00",
    timezone: "America/New_York",
    mode: "in_person",
    pausedAt: o.paused ? at(-48) : null,
  });
  const m: Partial<Record<Key, string>> = {};
  let day = 1;
  for (const [key, role] of Object.entries(roles) as [Key, Role][]) {
    m[key] = id();
    await db.insert(schema.memberships).values({
      id: m[key]!,
      clubId,
      userId: U[key],
      role,
      joinedAt: new Date(Date.UTC(2026, 0, day++)),
    });
  }
  return { clubId, m: m as Record<Key, string> };
}

let F: Record<string, string> = {};
type NightState = (typeof schema.nights.$inferInsert)["state"];
async function night(
  c: { clubId: string },
  picker: string,
  state: NightState,
  extra: Partial<typeof schema.nights.$inferInsert> = {},
) {
  const [n] = await db
    .insert(schema.nights)
    .values({ clubId: c.clubId, pickerMembershipId: picker, state, scheduledAt: at(48), ...extra })
    .returning();
  return n.id;
}
async function nominate(nightId: string, picker: string, titles = ["Arrival", "Thief", "Paddington 2"]) {
  const rows = await db
    .insert(schema.nominations)
    .values(titles.map((t, i) => ({ nightId, filmId: F[t], membershipId: picker, position: i + 1 })))
    .returning();
  return rows.map((r) => r.id);
}

// Per page at 375: controls whose target is under 44px (a control's target
// is the larger of its box, a positioned ::after hit area, and the label
// that wraps a checkbox or radio; links inside a sentence are exempt, WCAG
// 2.5.8), fields with no label, the heading outline, and inline styles.
async function measure(page: Page, name: string) {
  metrics[name] = await page.evaluate(() => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const label = (el: Element) =>
      (el.textContent || (el as HTMLInputElement).value || el.getAttribute("aria-label") || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 40);
    const inSentence = (el: Element) => {
      if (el.tagName !== "A" || getComputedStyle(el).display !== "inline") return false;
      const parent = el.parentElement;
      return !!parent && (parent.textContent ?? "").trim().length > (el.textContent ?? "").trim().length;
    };
    const target = (el: Element) => {
      const r = el.getBoundingClientRect();
      let w = r.width;
      let h = r.height;
      const after = getComputedStyle(el, "::after");
      if (after.content !== "none" && after.position === "absolute") {
        w = Math.max(w, parseFloat(after.width) || 0);
        h = Math.max(h, parseFloat(after.height) || 0);
      }
      const input = el as HTMLInputElement;
      if ((input.type === "checkbox" || input.type === "radio") && input.labels) {
        for (const l of input.labels) {
          const lr = l.getBoundingClientRect();
          w = Math.max(w, lr.width);
          h = Math.max(h, lr.height);
        }
      }
      return { w, h };
    };
    const targets = [...document.querySelectorAll("a, button, input:not([type=hidden]), select, textarea, summary")]
      .filter(visible)
      .filter((el) => !inSentence(el));
    const small = targets
      .map((el) => ({ el, t: target(el) }))
      .filter(({ t }) => t.h < 44 || t.w < 44)
      .map(({ el, t }) => `${el.tagName.toLowerCase()} ${Math.round(t.w)}x${Math.round(t.h)} "${label(el)}"`);
    const unlabeled = [...document.querySelectorAll("input:not([type=hidden]), select, textarea")]
      .filter(visible)
      .filter((el) => {
        const i = el as HTMLInputElement;
        return !(i.labels && i.labels.length) && !i.getAttribute("aria-label") && !i.getAttribute("aria-labelledby") && !i.title;
      })
      .map((el) => `${el.tagName.toLowerCase()}[name=${el.getAttribute("name")}]`);
    const headings = [...document.querySelectorAll("h1, h2, h3, h4")].filter(visible).map((h) => `${h.tagName}:${label(h)}`);
    return {
      small,
      unlabeled,
      headings,
      inline: document.querySelectorAll("main [style]").length,
      classed: document.querySelectorAll("main [class]").length,
      targets: targets.length,
    };
  });
}

async function shoot(page: Page, name: string, url: string) {
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(url);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.screenshot({ path: path.join(OUT, `${name}-${width}.png`), fullPage: true });
    if (width === 375) await measure(page, name);
  }
}

test("app screens", async ({ page, browser }) => {
  mkdirSync(OUT, { recursive: true });
  const films = await db
    .select()
    .from(schema.films)
    .where(inArray(schema.films.title, ["Arrival", "Hereditary", "Thief", "Paddington 2", "The Thing", "Chungking Express"]));
  F = Object.fromEntries(films.map((f) => [f.title, f.id]));
  for (const k of Object.keys(U) as Key[]) await user(k, U[k], NAMES[k]);
  // Watchlists (one per person).
  await db.insert(schema.watchlistItems).values([
    ...["Arrival", "Thief", "Paddington 2", "Chungking Express"].map((t) => ({ userId: U.ana, filmId: F[t] })),
    ...["Arrival", "Thief", "The Thing"].map((t) => ({ userId: U.ben, filmId: F[t] })),
    ...["Arrival", "Paddington 2"].map((t) => ({ userId: U.cal, filmId: F[t] })),
    { userId: U.dee, filmId: F["Hereditary"] },
  ]);

  // Tonight, one club per state.
  const nominating = await club("Nominate Club", { ana: "owner", ben: "admin", cal: "member", dee: "member" });
  await night(nominating, nominating.m.ana, "draft");
  const noneFits = await club("Nothing Fits Club", { dee: "owner", cal: "member", ana: "member" });
  await db.insert(schema.constraints).values({ membershipId: noneFits.m.cal, kind: "hard", ruleType: "genre", value: "27", label: "Horror" });
  await night(noneFits, noneFits.m.dee, "draft");
  const drafting = await club("Drafting Club", { ana: "owner", ben: "member", cal: "member" });
  await night(drafting, drafting.m.ben, "draft");
  const voting = await club("Saturday Club", { ana: "owner", ben: "admin", cal: "member", dee: "member" });
  const vNight = await night(voting, voting.m.ben, "open", { lockAt: at(20), scheduledAt: at(44) });
  const noms = await nominate(vNight, voting.m.ben);
  await db.insert(schema.votes).values({ nominationId: noms[0], membershipId: voting.m.ana });
  await db.insert(schema.rsvps).values([{ nightId: vNight, membershipId: voting.m.ana, status: "yes" }]);
  await db.insert(schema.constraints).values([
    { membershipId: voting.m.ana, kind: "hard", ruleType: "genre", value: "27", label: "Horror" },
    { membershipId: voting.m.ana, kind: "soft", ruleType: "runtime", value: "135", label: null },
  ]);
  await db.insert(schema.invites).values({
    clubId: voting.clubId,
    token: `audit${id().replaceAll("-", "").slice(0, 17)}`,
    inviteeName: "Eve E.",
    invitedByMembershipId: voting.m.ana,
  });
  const [invite] = await db.select().from(schema.invites).where(eq(schema.invites.clubId, voting.clubId));
  const locked = await club("Locked Club", { ana: "owner", ben: "member", cal: "member" });
  await night(locked, locked.m.ben, "locked", {
    scheduledAt: at(50),
    lockAt: at(26),
    lockedAt: at(-1),
    unconfirmAt: at(50 + 61),
    winningFilmId: F["Arrival"],
  });
  const confirm = await club("Confirm Club", { ana: "owner", ben: "member", cal: "member" });
  await night(confirm, confirm.m.ben, "locked", { scheduledAt: at(-40), lockedAt: at(-64), unconfirmAt: at(30), winningFilmId: F["Thief"] });
  const started = await club("Watching Club", { ana: "owner", ben: "member", cal: "member" });
  await night(started, started.m.ben, "locked", { scheduledAt: at(-1), lockedAt: at(-30), unconfirmAt: at(60), winningFilmId: F["Arrival"] });
  const late = await club("Late Club", { ana: "owner", ben: "member", cal: "member" });
  await night(late, late.m.ben, "unconfirmed", {
    scheduledAt: at(-100),
    unconfirmedAt: at(-20),
    confirmedAt: at(-20),
    winningFilmId: F["Thief"],
  });
  const rating = await club("Rating Club", { ana: "owner", ben: "member", cal: "member" });
  const rNight = await night(rating, rating.m.cal, "watched", {
    scheduledAt: at(-20),
    confirmedAt: at(-6),
    confirmedBy: rating.m.ana,
    winningFilmId: F["Arrival"],
  });
  await db.insert(schema.rsvps).values([
    { nightId: rNight, membershipId: rating.m.ana, status: "yes" },
    { nightId: rNight, membershipId: rating.m.ben, status: "yes" },
  ]);
  await db.insert(schema.ratings).values({ nightId: rNight, membershipId: rating.m.ben, scoreQuality: "8.0", scoreFun: "7.5", hotTake: "Quietly devastating." });
  const revealed = await club("Revealed Club", { ana: "owner", ben: "member", cal: "member" });
  const old1 = await night(revealed, revealed.m.ben, "watched", { scheduledAt: at(-24 * 15), confirmedAt: at(-24 * 14), winningFilmId: F["The Thing"] });
  await night(revealed, revealed.m.cal, "cancelled", { scheduledAt: at(-24 * 8), confirmedAt: at(-24 * 8) });
  await night(revealed, revealed.m.ana, "unconfirmed", { scheduledAt: at(-24 * 5), unconfirmedAt: at(-24 * 2), winningFilmId: F["Paddington 2"] });
  const rv = await night(revealed, revealed.m.ben, "watched", { scheduledAt: at(-20), confirmedAt: at(-6), winningFilmId: F["Arrival"] });
  const rvNoms = await nominate(rv, revealed.m.ben);
  await db.insert(schema.votes).values([
    { nominationId: rvNoms[0], membershipId: revealed.m.ana },
    { nominationId: rvNoms[0], membershipId: revealed.m.cal },
    { nominationId: rvNoms[1], membershipId: revealed.m.ben },
  ]);
  await db.insert(schema.rsvps).values([
    { nightId: rv, membershipId: revealed.m.ana, status: "yes" },
    { nightId: rv, membershipId: revealed.m.ben, status: "yes" },
    { nightId: old1, membershipId: revealed.m.ana, status: "yes" },
  ]);
  const [r1] = await db
    .insert(schema.ratings)
    .values({ nightId: rv, membershipId: revealed.m.ana, scoreQuality: "9.0", scoreFun: "6.5", hotTake: "The ending hit hard." })
    .returning();
  await db.insert(schema.ratings).values({ nightId: rv, membershipId: revealed.m.ben, scoreQuality: "7.5", scoreFun: "8.0", hotTake: null });
  await db.insert(schema.ratings).values({ nightId: old1, membershipId: revealed.m.ana, scoreQuality: "8.5", scoreFun: "9.5", hotTake: "Paranoia, perfected." });
  const [cozy] = await db.insert(schema.tags).values({ clubId: revealed.clubId, name: "cozy", displayName: "Cozy" }).returning();
  await db.insert(schema.ratingTags).values({ ratingId: r1.id, tagId: cozy.id });
  const paused = await club("Paused Club", { ana: "owner", ben: "member" }, { paused: true });

  // Accounts at the gates: no consent yet, and no name yet.
  const fay = id();
  await user("fay", fay, "Fay F.", false);
  const gus = id();
  await user("gus", gus, null, true);
  const token = "Aud1tToken" + "x".repeat(33);
  await db.insert(schema.reminderUnsubscribeTokens).values({ tokenHash: hashToken(token), userId: U.ana, clubId: voting.clubId });

  // Signed out.
  const out = await browser.newPage();
  await shoot(out, "marketing-signedout", "/");
  await shoot(out, "login", "/login");
  await holdSignInAddress(out, "ana.audit@example.com");
  await shoot(out, "login-code", "/login/code");
  await shoot(out, "invite-landing", `/invite/${invite.token}`);
  await shoot(out, "unsubscribe", `/unsubscribe/${token}`);
  await out.close();


  const as = (userId: string) => signInAsUser(page, userId);
  await as(U.ana);
  await shoot(page, "home-clubcards", "/");
  await shoot(page, "watchlist", "/watchlist");
  await shoot(page, "watchlist-search", "/watchlist?q=arrival");
  await shoot(page, "settings", "/settings");
  await shoot(page, "tonight-nominate-films", `/clubs/${nominating.clubId}`);
  await shoot(page, "tonight-someone-else-drafting", `/clubs/${drafting.clubId}`);
  await shoot(page, "tonight-voting-voted", `/clubs/${voting.clubId}`);
  await shoot(page, "tonight-locked", `/clubs/${locked.clubId}`);
  await shoot(page, "tonight-watch-started", `/clubs/${started.clubId}`);
  await shoot(page, "tonight-did-you-watch", `/clubs/${confirm.clubId}`);
  await shoot(page, "tonight-late-after-all", `/clubs/${late.clubId}`);
  await shoot(page, "tonight-rate-before-reveal", `/clubs/${rating.clubId}`);
  await shoot(page, "tonight-rate-after-reveal", `/clubs/${revealed.clubId}`);
  await shoot(page, "tonight-paused", `/clubs/${paused.clubId}`);
  await shoot(page, "history", `/clubs/${revealed.clubId}/history`);
  await shoot(page, "tag-page", `/clubs/${revealed.clubId}/tags/cozy`);
  await shoot(page, "members-owner", `/clubs/${voting.clubId}/members`);
  await shoot(page, "members-owner-remove-confirm", `/clubs/${voting.clubId}/members?remove=${voting.m.dee}`);
  await as(U.dee);
  await shoot(page, "tonight-nominate-none-fits", `/clubs/${noneFits.clubId}`);
  await as(U.ben);
  await shoot(page, "members-admin", `/clubs/${voting.clubId}/members`);
  await as(U.cal);
  await shoot(page, "tonight-voting-not-voted", `/clubs/${voting.clubId}`);
  // Cal never answered for Rating Club's night: "I was there" (u1).
  await shoot(page, "tonight-i-was-there", `/clubs/${rating.clubId}`);
  await shoot(page, "members-member", `/clubs/${voting.clubId}/members`);
  await shoot(page, "members-member-leave-confirm", `/clubs/${voting.clubId}/members?leave=1`);
  await as(fay);
  await shoot(page, "consent", "/consent");
  await as(gus);
  await shoot(page, "welcome", "/welcome");

  // Last, so it changes no screen above: an invited sign-up, step by step (u3): the code step and the name step
  // with the bar and the invite, then the club's welcome page.
  // Its own invite, to Drafting Club, so Saturday Club's screens stay as
  // they were.
  const [ownerOfDrafting] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, drafting.m.ana));
  const signUpToken = `auditsignup${id().replaceAll("-", "").slice(0, 11)}`;
  await db.insert(schema.invites).values({
    clubId: drafting.clubId,
    token: signUpToken,
    inviteeName: "Max",
    invitedByMembershipId: ownerOfDrafting.id,
  });
  const invitee = await browser.newPage();
  const inviteeEmail = `max.audit.${id().slice(0, 6)}@example.com`;
  await invitee.goto(`/invite/${signUpToken}`);
  await invitee.getByLabel("Your email").fill(inviteeEmail);
  await invitee.getByRole("button", { name: "Send my code" }).click();
  await invitee.waitForURL("**/login/code");
  await shoot(invitee, "login-code-invited", "/login/code");
  const { code } = await setKnownSignIn(inviteeEmail);
  await invitee.getByLabel("Your code").fill(code);
  await invitee.getByRole("button", { name: "Sign in", exact: true }).click();
  await invitee.waitForURL("**/welcome?**");
  const welcomeUrl = new URL(invitee.url()).pathname + new URL(invitee.url()).search;
  await shoot(invitee, "welcome-invited", welcomeUrl);
  await invitee.getByLabel("18 or older").check();
  await agreeToTerms(invitee);
  await invitee.getByRole("button", { name: "Continue" }).click();
  await invitee.waitForURL(`**/clubs/${drafting.clubId}/welcome`);
  await shoot(invitee, "club-welcome", `/clubs/${drafting.clubId}/welcome`);
  await invitee.close();

  writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify(metrics, null, 2));
  await client.end();
});

// "Start a club" with sign-up open (the open-signup server, u4): each step
// of the flow, as far as the build in front of it goes, then the new club.
test("start a club screens", async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  const context = await browser.newContext({ baseURL: "http://localhost:3102" });
  const page = await context.newPage();
  const email = `founder.audit.${id().slice(0, 6)}@example.com`;
  const shootHere = async (name: string) => {
    const url = new URL(page.url());
    await shoot(page, name, url.pathname + url.search);
  };
  await shoot(page, "start-marketing", "/");
  await page.getByRole("link", { name: "Start a club" }).first().click();
  // The click's navigation has to land before the URL is read.
  await page.waitForURL((url) => url.pathname !== "/");
  await shootHere("start-email");
  await page.getByLabel(/^Email/).fill(email);
  await page.getByRole("button", { name: /^Send/ }).click();
  await page.waitForURL("**/login/code**");
  await shootHere("start-code");
  const { code } = await setKnownSignIn(email);
  await page.getByLabel("Your code").fill(code);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/welcome**");
  await shootHere("start-welcome");
  await page.getByLabel("Display name").fill("Fern F.");
  await page.getByLabel("18 or older").check();
  await agreeToTerms(page);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL("**/new**");
  await shootHere("start-club");
  await page.getByLabel("Club name").fill("Fern's Film Club");
  await page.getByLabel(/^Time ?zone/i).fill("America/New_York");
  await page.getByRole("button", { name: "Create club" }).click();
  await page.waitForURL(/\/clubs\/[0-9a-f-]{36}$/);
  await shootHere("start-tonight");
  const clubPath = new URL(page.url()).pathname;
  const invite = await page.goto(`${clubPath}/members/invite`);
  if (invite?.ok()) await shootHere("start-invite");
  await context.close();
});

// docs/prototype.html's matching screens, in each of its themes.
test("prototype screens", async ({ page }) => {
  mkdirSync(PROTOTYPE_OUT, { recursive: true });
  await page.goto(`file://${path.join(ROOT, "docs/prototype.html")}`);
  const click = (seg: string, v: string) => page.locator(`#${seg} button[data-v="${v}"]`).click();
  for (const theme of ["late", "rep", "rental"]) {
    await click("segTheme", theme);
    for (const device of ["phone", "desktop"]) {
      await click("segDevice", device);
      await page.setViewportSize({ width: device === "phone" ? 700 : 1400, height: 1000 });
      for (const stage of ["nominate", "vote", "locked", "after"]) {
        await click("segStage", stage);
        await page.waitForTimeout(150);
        await page.locator("#frame").screenshot({ path: path.join(PROTOTYPE_OUT, `${theme}-tonight-${stage}-${device}.png`) });
      }
      for (const [name, label] of [
        ["history", "History"],
        ["members", "Members"],
        ["watchlist", "Watchlist"],
        ["settings", "Settings"],
        ["clubs", "Clubs"],
      ]) {
        const tab = page.locator("#app").getByRole("button", { name: label, exact: true }).first();
        if (await tab.count()) {
          await tab.click().catch(() => {});
          await page.waitForTimeout(150);
          await page.locator("#frame").screenshot({ path: path.join(PROTOTYPE_OUT, `${theme}-${name}-${device}.png`) });
        }
      }
      // Back into the club for the next round.
      const back = page.locator("#app").getByRole("button", { name: /Saturday Club/ }).first();
      if (await back.count()) await back.click().catch(() => {});
    }
  }
});
