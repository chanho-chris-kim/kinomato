// Runs once before the whole E2E suite. Re-seeds the dedicated E2E
// Neon branch fresh for this run — reuses db/seed.ts exactly (wipe,
// then insert the same fixture db/seed-fixtures.ts and the tests both
// reference) rather than duplicating seed logic.
//
// E2E_DATABASE_URL must point at a database that's safe to wipe. It is
// never dev.kinomato.com's database and never read from DATABASE_URL —
// those are separate env vars on purpose, so a missing E2E_DATABASE_URL
// fails loudly here instead of silently falling back to whatever
// DATABASE_URL happens to be set to.
import { execFileSync } from "node:child_process";

export default function globalSetup() {
  const e2eDatabaseUrl = process.env.E2E_DATABASE_URL;
  if (!e2eDatabaseUrl) {
    throw new Error(
      "E2E_DATABASE_URL is not set. Point it at a dedicated Neon branch " +
        "that's safe to wipe — never dev.kinomato.com's database. See " +
        "CLAUDE.md's Stack section.",
    );
  }

  execFileSync("npx", ["tsx", "db/seed.ts"], {
    env: { ...process.env, DATABASE_URL: e2eDatabaseUrl },
    stdio: "inherit",
  });
}
