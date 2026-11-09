import { neon } from "@neondatabase/serverless";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../db/schema";
import { runRetentionCleanup } from "../app/retentionCleanup";
import { expect, test } from "./fixtures";

// The daily retention job (docs/onboarding-spec.md §11.6), called directly
// against this run's database with the Worker's own driver (neon-http, the
// one with db.batch): the Cron Trigger is the only thing that runs it in
// production, and no route reaches it. Old and fresh rows in every table
// it touches, either side of each boundary.

const id = () => crypto.randomUUID();
const NOW = new Date();
const ago = (days: number, hours = 0) => new Date(NOW.getTime() - (days * 24 + hours) * 3600_000);

test("deletes only what's past retention, and clears only old revoked invites' names", async () => {
  const db = drizzle(neon(process.env.E2E_DATABASE_URL!), { schema });
  const user = id();
  const club = id();
  const membership = id();
  const old = { link: id(), change: id(), deletion: id(), session: id() };
  const fresh = { link: id(), change: id(), deletion: id(), session: id() };
  const invite = { revokedOld: id(), revokedRecent: id(), pending: id(), redeemed: id() };

  await db.insert(schema.users).values({ id: user, email: "retention.check@example.com", displayName: "Rhea T." });
  await db.insert(schema.clubs).values({
    id: club,
    name: "Retention Club",
    cadence: "weekly",
    defaultDay: 6,
    defaultTime: "20:00",
    timezone: "America/New_York",
    mode: "in_person",
  });
  await db.insert(schema.memberships).values({ id: membership, clubId: club, userId: user, role: "owner" });
  await db.insert(schema.magicLinks).values([
    { id: old.link, email: "retention.check@example.com", tokenHash: `r-${id()}`, expiresAt: ago(7, 1) },
    { id: fresh.link, email: "retention.check@example.com", tokenHash: `r-${id()}`, expiresAt: ago(6, 23) },
  ]);
  await db.insert(schema.emailChanges).values([
    { id: old.change, userId: user, newEmail: "r1@example.com", codeHash: "x", expiresAt: ago(7, 1), consumedAt: ago(8) },
    { id: fresh.change, userId: user, newEmail: "r2@example.com", codeHash: "x", expiresAt: ago(6, 23) },
  ]);
  await db.insert(schema.accountDeletionRequests).values([
    { id: old.deletion, userId: user, codeHash: "x", expiresAt: ago(7, 1), cancelledAt: ago(8) },
    { id: fresh.deletion, userId: user, codeHash: "x", expiresAt: ago(6, 23) },
  ]);
  await db.insert(schema.sessions).values([
    { id: old.session, userId: user, tokenHash: `r-${id()}`, expiresAt: ago(7, 1) },
    { id: fresh.session, userId: user, tokenHash: `r-${id()}`, expiresAt: ago(6, 23) },
  ]);
  const inviteRow = (inviteId: string, inviteeName: string, extra: object) => ({
    id: inviteId,
    clubId: club,
    token: `r-${id()}`,
    inviteeName,
    invitedByMembershipId: membership,
    ...extra,
  });
  await db.insert(schema.invites).values([
    inviteRow(invite.revokedOld, "Old R.", { revokedAt: ago(91) }),
    inviteRow(invite.revokedRecent, "Recent R.", { revokedAt: ago(89) }),
    inviteRow(invite.pending, "Pending P.", {}),
    inviteRow(invite.redeemed, "Redeemed R.", { redeemedAt: ago(200), redeemedByUserId: user }),
  ]);

  const logged: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => logged.push(args.join(" "));
  let counts;
  try {
    counts = await runRetentionCleanup(db, NOW);
  } finally {
    console.log = original;
  }

  // Only the old rows went.
  const ids = async <T extends { id: string }>(rows: Promise<T[]>) => (await rows).map((r) => r.id).sort();
  expect(
    await ids(db.select({ id: schema.magicLinks.id }).from(schema.magicLinks).where(inArray(schema.magicLinks.id, [old.link, fresh.link]))),
  ).toEqual([fresh.link]);
  expect(
    await ids(
      db.select({ id: schema.emailChanges.id }).from(schema.emailChanges).where(inArray(schema.emailChanges.id, [old.change, fresh.change])),
    ),
  ).toEqual([fresh.change]);
  expect(
    await ids(
      db
        .select({ id: schema.accountDeletionRequests.id })
        .from(schema.accountDeletionRequests)
        .where(inArray(schema.accountDeletionRequests.id, [old.deletion, fresh.deletion])),
    ),
  ).toEqual([fresh.deletion]);
  expect(
    await ids(db.select({ id: schema.sessions.id }).from(schema.sessions).where(inArray(schema.sessions.id, [old.session, fresh.session]))),
  ).toEqual([fresh.session]);

  // Only the invite revoked over 90 days ago lost its name; pending and
  // redeemed invites keep theirs.
  const names = Object.fromEntries(
    (
      await db
        .select({ id: schema.invites.id, name: schema.invites.inviteeName })
        .from(schema.invites)
        .where(inArray(schema.invites.id, Object.values(invite)))
    ).map((r) => [r.id, r.name]),
  );
  expect(names).toEqual({
    [invite.revokedOld]: "",
    [invite.revokedRecent]: "Recent R.",
    [invite.pending]: "Pending P.",
    [invite.redeemed]: "Redeemed R.",
  });

  // Counts at least ours (other specs' rows may also be past retention),
  // logged as one line of counts and nothing else.
  expect(counts!.sign_in_codes).toBeGreaterThanOrEqual(1);
  expect(counts!.email_change_requests).toBeGreaterThanOrEqual(1);
  expect(counts!.deletion_requests).toBeGreaterThanOrEqual(1);
  expect(counts!.sessions).toBeGreaterThanOrEqual(1);
  expect(counts!.invite_names_cleared).toBeGreaterThanOrEqual(1);
  expect(logged).toEqual([`[retention] ${JSON.stringify(counts)}`]);
  expect(logged[0]).not.toContain("@");
  expect(logged[0]).not.toContain(user);

  // A second run finds the name already cleared and doesn't count it again.
  console.log = () => {};
  try {
    const again = await runRetentionCleanup(db, NOW);
    expect(again.invite_names_cleared).toBe(0);
  } finally {
    console.log = original;
  }
});
