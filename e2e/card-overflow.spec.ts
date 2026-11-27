import type { Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import { hashToken } from "../lib/authCredentials";
import { generateJoinCode } from "../lib/joinCode";
import { LEGAL } from "../lib/legal";
import { expect, test } from "./fixtures";
import { signInAsUser } from "./session";
import { holdSignInAddress } from "./signIn";

// The signed-out and gate pages' forms stay inside their frame at phone
// and laptop widths: the card where there is one (/welcome, /consent, the
// invite landing), else the page's capped column (/login, /login/code,
// /unsubscribe). Every field is shown: the accounts here have answered
// nothing yet. And no page scrolls sideways.

const id = () => crypto.randomUUID();
const at = new Date(Date.UTC(2026, 0, 1));

// Elements that stick out of the frame, as "tag.class right-edge>frame".
async function overflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    // Every card on the page (since u3 a sign-up step has the invite card
    // and the form's card), and the page's own column.
    const main = document.querySelector("main");
    if (!main) return ["no frame"];
    const frames = [...main.querySelectorAll(".card"), main];
    const out: string[] = [];
    for (const frame of frames) {
      const f = frame.getBoundingClientRect();
      for (const el of frame.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.right > f.right + 0.5 || r.left < f.left - 0.5) {
          out.push(`${el.tagName.toLowerCase()}.${el.className} ${Math.round(r.left)}–${Math.round(r.right)} outside ${frame.tagName.toLowerCase()}.${frame.className} ${Math.round(f.left)}–${Math.round(f.right)}`);
        }
      }
    }
    if (document.documentElement.scrollWidth > window.innerWidth) {
      out.push(`page ${document.documentElement.scrollWidth}px wide in a ${window.innerWidth}px window`);
    }
    return out;
  });
}

test.describe("card-wrapped forms fit their frame", () => {
  const pages: { name: string; url: string; as?: string; hold?: string }[] = [];

  test.beforeAll(async () => {
    const client = postgres(process.env.E2E_DATABASE_URL!, { max: 1 });
    const db = drizzle(client, { schema });
    try {
      // An owner and a club with a pending invite and an unsubscribe link.
      const owner = id();
      await db.insert(schema.users).values({ id: owner, email: `fit.owner.${owner.slice(0, 8)}@example.com`, displayName: "Oda O.", ageBracket: "18_plus", ageAttestedAt: at });
      await db.insert(schema.consentEvents).values(
        (["terms", "privacy"] as const).map((document) => ({ userId: owner, document, version: LEGAL[document].version, acceptedAt: at, method: "signup" as const })),
      );
      const clubId = id();
      await db.insert(schema.clubs).values({ id: clubId, name: "A Club With Quite a Long Name for Fitting", cadence: "weekly", defaultDay: 6, defaultTime: "20:00", timezone: "America/New_York", mode: "in_person" });
      const membershipId = id();
      await db.insert(schema.memberships).values({ id: membershipId, clubId, userId: owner, role: "owner", joinedAt: at });
      const inviteToken = `fit${id().replaceAll("-", "")}`.slice(0, 22);
      await db.insert(schema.invites).values({ clubId, token: inviteToken, inviteeName: "Max M.", invitedByMembershipId: membershipId });
      // A second member with a long name, a limit each, and someone asking
      // to join: the Members pages (u6) with every card they can show.
      const other = id();
      await db.insert(schema.users).values({ id: other, email: `fit.other.${other.slice(0, 8)}@example.com`, displayName: "Bartholomew-Maximilian Q.", ageBracket: "18_plus", ageAttestedAt: at });
      const otherMembership = id();
      await db.insert(schema.memberships).values({ id: otherMembership, clubId, userId: other, role: "member", joinedAt: at });
      await db.insert(schema.constraints).values([
        { membershipId, kind: "hard", ruleType: "genre", value: "27", label: "Horror" },
        { membershipId, kind: "soft", ruleType: "runtime", value: "150", label: null },
      ]);
      const asker = id();
      await db.insert(schema.users).values({ id: asker, email: `fit.asker.${asker.slice(0, 8)}@example.com`, displayName: "Wilhelmina-Josephine R." });
      await db.insert(schema.joinRequests).values({ clubId, userId: asker });
      await db.update(schema.clubs).set({ joinCode: generateJoinCode() }).where(eq(schema.clubs.id, clubId));
      const unsubscribe = `Fit${id().replaceAll("-", "")}${id().replaceAll("-", "")}`;
      await db.insert(schema.reminderUnsubscribeTokens).values({ tokenHash: hashToken(unsubscribe), userId: owner, clubId });
      // Nothing answered: /consent asks age, Terms and data sharing.
      const unconsented = id();
      await db.insert(schema.users).values({ id: unconsented, email: `fit.consent.${unconsented.slice(0, 8)}@example.com`, displayName: "Una U." });
      // Brand new: /welcome asks name, age, Terms and data sharing.
      const fresh = id();
      await db.insert(schema.users).values({ id: fresh, email: `fit.welcome.${fresh.slice(0, 8)}@example.com` });

      pages.push(
        { name: "/login", url: "/login" },
        { name: "/login/code", url: "/login/code", hold: "fit.someone@example.com" },
        { name: "invite landing", url: `/invite/${inviteToken}` },
        { name: "/unsubscribe", url: `/unsubscribe/${unsubscribe}` },
        { name: "/consent", url: "/consent", as: unconsented },
        { name: "/welcome", url: "/welcome", as: fresh },
        { name: "Members", url: `/clubs/${clubId}/members`, as: owner },
        { name: "Members: a person", url: `/clubs/${clubId}/members/${otherMembership}`, as: owner },
        { name: "Members: your limits", url: `/clubs/${clubId}/members/limits`, as: owner },
        { name: "Members: how it runs", url: `/clubs/${clubId}/members/settings`, as: owner },
        { name: "Members: pause", url: `/clubs/${clubId}/members/settings/pause`, as: owner },
      );
    } finally {
      await client.end();
    }
  });

  for (const width of [375, 1280]) {
    test(`nothing overflows at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const p of pages) {
        await page.context().clearCookies();
        if (p.as) await signInAsUser(page, p.as);
        if (p.hold) await holdSignInAddress(page, p.hold);
        await page.goto(p.url);
        expect(new URL(page.url()).pathname, p.name).toBe(p.url);
        expect(await overflow(page), `${p.name} at ${width}px`).toEqual([]);
        // The age question, then the data-sharing box that "18 or older"
        // reveals: every field the page can show.
        if (p.name === "/welcome" || p.name === "/consent") {
          await page.locator('input[name="age"][value="18_plus"]').check();
          await expect(page.locator('input[name="licensing"]')).toBeVisible();
          expect(await overflow(page), `${p.name} at ${width}px, 18 or older chosen`).toEqual([]);
        }
      }
    });
  }
});
