// Runs once before the whole E2E suite. Rebuilds the E2E database from
// scratch for this run, in three steps:
//
//   1. Drop and recreate the `public` schema — every table, enum and row.
//   2. `drizzle-kit push --force` this branch's db/schema.ts onto it.
//   3. Seed it with db/seed.ts (the same fixture db/seed-fixtures.ts and
//      the tests both reference).
//
// Steps 1–2 are why a feature branch that changes the schema can't break
// another branch's run: each run brings its own schema instead of
// inheriting whatever the last person pushed. Starting from an empty
// schema also sidesteps drizzle-kit's interactive "was this column
// renamed?" prompt, which --force doesn't answer.
//
// E2E_DATABASE_URL must point at a Neon branch that's safe to wipe, and
// there are two of them on purpose: CI's (the E2E_DATABASE_URL secret) and
// each developer's own (e.g. `e2e-local`, set in their .env). A local run
// and a CI run sharing one branch wipe each other mid-run — that's what
// produced phantom failures before the split. It is never
// dev.kinomato.com's database and never read from DATABASE_URL — separate
// env vars on purpose, so a missing E2E_DATABASE_URL fails loudly here
// instead of silently falling back to whatever DATABASE_URL is set to.
import { execFileSync } from "node:child_process";
import postgres from "postgres";

export default async function globalSetup() {
  const e2eDatabaseUrl = process.env.E2E_DATABASE_URL;
  if (!e2eDatabaseUrl) {
    throw new Error(
      "E2E_DATABASE_URL is not set. Point it at your own Neon branch " +
        "that's safe to wipe (e.g. e2e-local) — never dev.kinomato.com's " +
        "database. See CLAUDE.md's Conventions section.",
    );
  }
  // Step 1 drops the whole schema, so refuse outright if the E2E URL is
  // the app's own database — a copy-paste slip in .env would otherwise
  // wipe it.
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === e2eDatabaseUrl) {
    throw new Error(
      "E2E_DATABASE_URL is the same as DATABASE_URL. The E2E setup drops " +
        "and recreates the whole schema; point E2E_DATABASE_URL at a " +
        "separate, wipeable Neon branch.",
    );
  }

  const sql = postgres(e2eDatabaseUrl, { onnotice: () => {} });
  try {
    await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  } finally {
    await sql.end();
  }

  const env = { ...process.env, DATABASE_URL: e2eDatabaseUrl };
  execFileSync("npx", ["drizzle-kit", "push", "--force"], { env, stdio: "inherit" });
  execFileSync("npx", ["tsx", "db/seed.ts"], { env, stdio: "inherit" });
}
