import type { Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import { CLUB_7_ID, DISPLAY_NAME_7, FULL_CLUB_INVITE, MEMBERSHIP_7 } from "../db/seed-fixtures";
import { describeSchedule } from "../lib/format";
import { expect, test } from "./fixtures";

// Invite link previews (docs/onboarding-spec.md §5.1; rebuild step 5e):
// the free-plan version, one static image plus per-invite text tags. A
// chat app fetches these signed out, so every test here is signed out.
// Serial: one invite, inserted for this file and removed after it.
test.describe.configure({ mode: "serial" });

const TOKEN = "invite-preview-token-e2e";
const GENERIC_TITLE = "Kinomato — Whose turn is it?";

async function withDb<T>(fn: (db: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>): Promise<T> {
  const client = postgres(process.env.E2E_DATABASE_URL!);
  try {
    return await fn(drizzle(client, { schema }));
  } finally {
    await client.end();
  }
}

const meta = (page: Page, property: string) =>
  page.locator(`head meta[property="${property}"], head meta[name="${property}"]`);

test.describe("invite link previews", () => {
  // Club 7 (Wes and Uma) has seats free, so this invite is valid.
  test.beforeAll(async () => {
    await withDb((db) =>
      db.insert(schema.invites).values({
        clubId: CLUB_7_ID,
        token: TOKEN,
        inviteeName: "Pia L.",
        invitedByMembershipId: MEMBERSHIP_7.wes,
      }),
    );
  });
  test.afterAll(async () => {
    await withDb((db) => db.delete(schema.invites).where(eq(schema.invites.token, TOKEN)));
  });

  test("a valid invite: personalized title and description, the image on this host, never indexed", async ({
    page,
    request,
  }) => {
    const [club] = await withDb((db) => db.select().from(schema.clubs).where(eq(schema.clubs.id, CLUB_7_ID)));
    const response = await page.goto(`/invite/${TOKEN}`);
    expect(response?.status()).toBe(200);

    await expect(meta(page, "og:title")).toHaveAttribute(
      "content",
      `${DISPLAY_NAME_7.wes} invited you to ${club.name}`,
    );
    await expect(meta(page, "og:description")).toHaveAttribute(
      "content",
      `Join ${club.name} on Kinomato. ${describeSchedule(club)}.`,
    );
    // Nothing about the members beyond who sent it.
    const head = await page.locator("head").innerHTML();
    expect(head).not.toContain(DISPLAY_NAME_7.uma);

    const image = await meta(page, "og:image").getAttribute("content");
    const pageOrigin = new URL(page.url()).origin;
    expect(new URL(image!).origin).toBe(pageOrigin);
    expect(new URL(image!).pathname).toBe("/og-default.png");
    const png = await request.get(image!);
    expect(png.status()).toBe(200);
    expect(png.headers()["content-type"]).toBe("image/png");
    await expect(meta(page, "twitter:card")).toHaveAttribute("content", "summary_large_image");

    await expect(meta(page, "robots")).toHaveAttribute("content", "noindex, nofollow");
  });

  test("the tags are in <head> for any link previewer, not only the crawlers Next knows", async ({ request }) => {
    for (const ua of ["TelegramBot (like TwitterBot)", "kakaotalk-scrap/1.1", "Mozilla/5.0 Signal-Desktop"]) {
      const html = await (await request.get(`/invite/${TOKEN}`, { headers: { "user-agent": ua } })).text();
      const head = html.slice(0, html.indexOf("</head>"));
      expect(head, ua).toContain(`property="og:title" content="${DISPLAY_NAME_7.wes} invited you to`);
      expect(head, ua).toContain('property="og:image"');
      expect(head, ua).toContain('name="robots" content="noindex, nofollow"');
    }
  });

  test("loading the invite page, metadata and all, writes nothing: started_at stays empty", async ({
    page,
    request,
  }) => {
    const before = await withDb((db) => db.select().from(schema.invites).where(eq(schema.invites.token, TOKEN)));
    expect(before[0].startedAt).toBeNull();
    // A preview fetch is a plain GET, and so is a person opening it.
    expect((await request.get(`/invite/${TOKEN}`)).status()).toBe(200);
    await page.goto(`/invite/${TOKEN}`);
    await expect(page.getByRole("heading", { name: "Hi Pia" })).toBeVisible();
    const after = await withDb((db) => db.select().from(schema.invites).where(eq(schema.invites.token, TOKEN)));
    expect(after).toEqual(before);
  });

  test("an unknown token: the generic preview, nothing about any club, never indexed", async ({ page }) => {
    await page.goto("/invite/not-a-real-token");
    await expect(meta(page, "og:title")).toHaveAttribute("content", GENERIC_TITLE);
    await expect(meta(page, "og:image")).toHaveAttribute("content", /\/og-default\.png$/);
    await expect(meta(page, "robots")).toHaveAttribute("content", "noindex, nofollow");
    const head = await page.locator("head").innerHTML();
    for (const word of ["Seventh Club", "Movie Night Crew", "invited you"]) expect(head).not.toContain(word);
  });

  test("a full club's invite: also generic", async ({ page }) => {
    await page.goto(`/invite/${FULL_CLUB_INVITE.token}`);
    await expect(meta(page, "og:title")).toHaveAttribute("content", GENERIC_TITLE);
    const head = await page.locator("head").innerHTML();
    expect(head).not.toContain("Movie Night Crew");
  });

  test("every other page carries the generic preview", async ({ page }) => {
    await page.goto("/login");
    await expect(meta(page, "og:title")).toHaveAttribute("content", GENERIC_TITLE);
    await expect(meta(page, "og:image")).toHaveAttribute("content", `${new URL(page.url()).origin}/og-default.png`);
    await expect(meta(page, "robots")).toHaveCount(0);
  });
});
