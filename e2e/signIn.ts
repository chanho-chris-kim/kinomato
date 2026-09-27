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

// Simulates time passing for the per-address send limits (30s cooldown,
// 5 an hour): moves every sign-in row for the address two hours into the
// past, so a test that needs a fresh code for an address an earlier test
// already used isn't rate-limited by timing it doesn't control.
export async function forgetRecentSends(email: string): Promise<void> {
  const client = postgres(process.env.E2E_DATABASE_URL!);
  try {
    await client`
      update magic_links set created_at = created_at - interval '2 hours' where email = ${email}
    `;
  } finally {
    await client.end();
  }
}
