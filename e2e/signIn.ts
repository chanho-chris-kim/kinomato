import { expect, type Page } from "@playwright/test";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import { getAuthSecret, hashCode, hashToken } from "../lib/authCredentials";

// The code and link token are stored only as hashes, so a test can't read
// them back (docs/onboarding-spec.md §8.3). Instead, after asking for a
// code through the UI, a test overwrites the newest sign-in row for that
// address with hashes of a code and token it chose, then types the code or
// visits /verify?token=. Uses the app's own hashing and the same
// AUTH_SECRET the server under test has (playwright.config.ts). A direct
// write to the E2E database, same as e2e/session.ts — never an app route.
export const KNOWN_CODE = "246810";

export async function setKnownSignIn(email: string): Promise<{ code: string; token: string }> {
  const token = crypto.randomUUID();
  const client = postgres(process.env.E2E_DATABASE_URL!);
  const db = drizzle(client, { schema });
  try {
    const [row] = await db
      .select({ id: schema.magicLinks.id })
      .from(schema.magicLinks)
      .where(eq(schema.magicLinks.email, email))
      .orderBy(desc(schema.magicLinks.createdAt))
      .limit(1);
    if (!row) throw new Error(`setKnownSignIn: no sign-in row for ${email} — request a code first.`);
    await db
      .update(schema.magicLinks)
      .set({ codeHash: hashCode(KNOWN_CODE, getAuthSecret()), tokenHash: hashToken(token) })
      .where(eq(schema.magicLinks.id, row.id));
    return { code: KNOWN_CODE, token };
  } finally {
    await client.end();
  }
}

// Read-only look at the newest sign-in row, for asserting what a request
// did or didn't do to it (e.g. that opening /verify didn't consume it).
export async function latestSignInRow(email: string) {
  const client = postgres(process.env.E2E_DATABASE_URL!);
  const db = drizzle(client, { schema });
  try {
    const [row] = await db
      .select()
      .from(schema.magicLinks)
      .where(eq(schema.magicLinks.email, email))
      .orderBy(desc(schema.magicLinks.createdAt))
      .limit(1);
    return row ?? null;
  } finally {
    await client.end();
  }
}

// On the code screen (after asking for a code by any route): set a known
// code on the newest row, type it, submit.
export async function finishCodeSignIn(page: Page, email: string): Promise<void> {
  await expect(page).toHaveURL(/\/login\/code/);
  await expect(page.getByText(email)).toBeVisible();
  const { code } = await setKnownSignIn(email);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

// The consent controls on /welcome or /consent (docs/onboarding-spec.md
// §11.1–§11.3): 18 or older, and the Terms box. The optional data-sharing
// box is left as it is, unchecked.
export async function agreeToTerms(page: Page): Promise<void> {
  await page.getByLabel("18 or older").check();
  await page.getByLabel(/^I agree to the Terms/).check();
}

// The one-time name step a brand-new account sees, consent included.
export async function nameYourself(page: Page, firstName: string, lastInitial: string): Promise<void> {
  await expect(page).toHaveURL(/\/welcome/);
  await page.getByLabel("First name").fill(firstName);
  await page.getByLabel("Last initial").fill(lastInitial);
  await agreeToTerms(page);
  await page.getByRole("button", { name: "Continue" }).click();
  // Wait for the save to land: until it has, every signed-in page sends
  // this account back to /welcome (the consent gate).
  await expect(page).not.toHaveURL(/\/welcome/);
}

// An email change (rebuild step 7b) stores its code only as a hash too:
// overwrite the person's newest change request (or the one to `newEmail`)
// with a known code, then type it on /settings. A direct write to the E2E
// database, never an app route.
export async function setKnownEmailChangeCode(userEmail: string, newEmail?: string): Promise<string> {
  const client = postgres(process.env.E2E_DATABASE_URL!);
  const db = drizzle(client, { schema });
  try {
    const [user] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, userEmail));
    if (!user) throw new Error(`setKnownEmailChangeCode: no account for ${userEmail}`);
    const rows = await db
      .select({ id: schema.emailChanges.id, newEmail: schema.emailChanges.newEmail })
      .from(schema.emailChanges)
      .where(eq(schema.emailChanges.userId, user.id))
      .orderBy(desc(schema.emailChanges.createdAt));
    const row = newEmail ? rows.find((r) => r.newEmail === newEmail) : rows[0];
    if (!row) throw new Error(`setKnownEmailChangeCode: no change request for ${userEmail}`);
    await db
      .update(schema.emailChanges)
      .set({ codeHash: hashCode(KNOWN_CODE, getAuthSecret()) })
      .where(eq(schema.emailChanges.id, row.id));
    return KNOWN_CODE;
  } finally {
    await client.end();
  }
}
