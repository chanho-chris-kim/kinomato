import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../db/schema";
import { confirmAccountDeletion } from "../app/accountDeletion";
import { confirmEmailChange } from "../app/emailChange";
import { checkSignInCode } from "../app/signInCode";
import { CODE_MAX_ATTEMPTS, getAuthSecret, hashCode } from "../lib/authCredentials";
import { expect, test } from "./fixtures";
import { KNOWN_CODE } from "./signIn";

// Five wrong codes lock a code, however fast they arrive. Each guess has
// to claim one of the five tries in the database before it's compared, so
// ten guesses sent at once get five comparisons between them, never ten.
// Calls the server's own code checks directly, on the app's driver
// (neon-http), with every guess in flight at the same time: the browser
// can't send them that fast, an attacker's script can.
const db = drizzle(neon(process.env.E2E_DATABASE_URL!), { schema });
const WRONG = "000000"; // not KNOWN_CODE
const AT_ONCE = 10;
const later = () => new Date(Date.now() + 15 * 60_000);

async function newUser(tag: string) {
  const [user] = await db
    .insert(schema.users)
    .values({ email: `race.${tag}.${crypto.randomUUID().slice(0, 8)}@example.com` })
    .returning();
  return user;
}

test.describe("wrong-code lock under simultaneous guesses", () => {
  test("sign-in: ten at once spend the five tries, and then even the right code is refused", async () => {
    const email = `race.signin.${crypto.randomUUID().slice(0, 8)}@example.com`;
    const [link] = await db
      .insert(schema.magicLinks)
      .values({ email, codeHash: hashCode(KNOWN_CODE, getAuthSecret()), expiresAt: later() })
      .returning();

    // Every request read the row before any of them counted (as ten
    // simultaneous requests would).
    const results = await Promise.all(Array.from({ length: AT_ONCE }, () => checkSignInCode(db, link, WRONG, new Date())));
    const compared = results.filter((r) => !r.ok && r.error === "wrong").length;
    expect(compared).toBe(CODE_MAX_ATTEMPTS - 1);
    expect(results.filter((r) => !r.ok && r.error === "locked")).toHaveLength(AT_ONCE - compared);
    const [after] = await db.select().from(schema.magicLinks).where(eq(schema.magicLinks.id, link.id));
    expect(after.attempts).toBe(CODE_MAX_ATTEMPTS);
    // The stale read still says usable; the database says no.
    expect(await checkSignInCode(db, link, KNOWN_CODE, new Date())).toEqual({ ok: false, error: "locked" });
  });

  test("delete account: ten at once get four 'didn't work', then locked", async () => {
    const user = await newUser("delete");
    await db
      .insert(schema.accountDeletionRequests)
      .values({ userId: user.id, codeHash: hashCode(KNOWN_CODE, getAuthSecret()), expiresAt: later() });

    const results = await Promise.all(
      Array.from({ length: AT_ONCE }, () => confirmAccountDeletion(db, user, WRONG, new Date())),
    );
    const errors = results.map((r) => (r.ok ? "ok" : r.error));
    expect(errors.filter((e) => e === "That code didn't work.")).toHaveLength(CODE_MAX_ATTEMPTS - 1);
    expect(errors.filter((e) => e === "Too many wrong codes. Ask for a new one.")).toHaveLength(
      AT_ONCE - (CODE_MAX_ATTEMPTS - 1),
    );
    const [row] = await db
      .select()
      .from(schema.accountDeletionRequests)
      .where(eq(schema.accountDeletionRequests.userId, user.id));
    expect(row.attempts).toBe(CODE_MAX_ATTEMPTS);
    expect(await confirmAccountDeletion(db, user, KNOWN_CODE, new Date())).toEqual({
      ok: false,
      error: "Too many wrong codes. Ask for a new one.",
    });
    const [still] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(still.email).toBe(user.email);
  });

  test("email change: ten at once get four 'didn't work', then locked", async () => {
    process.env.SUPPORT_EMAIL ||= "support@kinomato.test";
    const user = await newUser("change");
    const newEmail = `race.new.${crypto.randomUUID().slice(0, 8)}@example.com`;
    await db
      .insert(schema.emailChanges)
      .values({ userId: user.id, newEmail, codeHash: hashCode(KNOWN_CODE, getAuthSecret()), expiresAt: later() });
    const noSessions = async () => {};

    const results = await Promise.all(
      Array.from({ length: AT_ONCE }, () => confirmEmailChange(db, user, WRONG, new Date(), noSessions)),
    );
    const errors = results.map((r) => (r.ok ? "ok" : r.error));
    expect(errors.filter((e) => e === "That code didn't work.")).toHaveLength(CODE_MAX_ATTEMPTS - 1);
    expect(errors.filter((e) => e === "Too many wrong codes. Ask for a new one.")).toHaveLength(
      AT_ONCE - (CODE_MAX_ATTEMPTS - 1),
    );
    const [row] = await db.select().from(schema.emailChanges).where(eq(schema.emailChanges.userId, user.id));
    expect(row.attempts).toBe(CODE_MAX_ATTEMPTS);
    expect(await confirmEmailChange(db, user, KNOWN_CODE, new Date(), noSessions)).toEqual({
      ok: false,
      error: "Too many wrong codes. Ask for a new one.",
    });
    const [still] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(still.email).toBe(user.email);
  });
});
