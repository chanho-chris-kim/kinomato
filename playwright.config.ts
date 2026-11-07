import "dotenv/config";
import { EMAIL_OUTBOX_FILE } from "./e2e/outbox";
import { BUMP_PORT, BUMPED_TERMS_VERSION } from "./e2e/legalBump";

// Sign-in codes are HMAC-signed with AUTH_SECRET (lib/authCredentials.ts),
// and CI's production build refuses to run without one. E2E brings its own
// throwaway value unless one is already set; the server under test and
// the test process (e2e/signIn.ts, which writes code hashes) must agree,
// so it's set here, before either reads it.
process.env.AUTH_SECRET ??= "e2e-only-auth-secret-not-a-real-one";
import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

// The environment both servers run with.
const SERVER_ENV = {
  // The app's own DATABASE_URL, deliberately overridden to the E2E
  // branch for the lifetime of this server — never dev.kinomato.com's
  // database. globalSetup already validated E2E_DATABASE_URL is set.
  DATABASE_URL: process.env.E2E_DATABASE_URL!,
  // Explicitly cleared, not just left unset — a developer's own
  // .env has a real token for local `npm run dev`, and this
  // webServer env is merged onto (not a replacement for) the
  // inherited process.env, so without this override a local E2E run
  // would silently start hitting the real TMDB API. Empty string
  // forces lib/tmdb.ts's fixture fallback, same as CI (which never
  // has a token at all).
  TMDB_READ_TOKEN: "",
  // Same reasoning: without this, a local run would send real magic
  // links through Brevo to the seeded @example.com addresses.
  BREVO_API_KEY: "",
  // With no Brevo key, lib/email.ts also appends each message here, so
  // specs can check what would have been sent (e2e/outbox.ts). Emptied
  // by global setup at the start of every run.
  EMAIL_OUTBOX_FILE: EMAIL_OUTBOX_FILE,
  // The email-change notice's Reply-To (lib/email.ts fails loud
  // without it). A test value unless one is already set; production's
  // is a Worker secret.
  SUPPORT_EMAIL: process.env.SUPPORT_EMAIL || "support@kinomato.test",
};

// A version bump in lib/legal.ts must send every signed-in account back
// through /consent (docs/onboarding-spec.md §11.1). The code under test
// can't change mid-run, so CI starts a second server on the same build
// and database with the Terms version bumped (lib/legal.ts currentLegal),
// and e2e/legal-bump.spec.ts runs against it alone. CI only: next dev
// locks its build directory, so a second dev server can't run beside the
// first; locally that one spec is left out.
const withBumpServer = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",

  // Tests share one mutable Neon branch and build on each other's state
  // within a scenario (vote, then change that same vote) — running them
  // in parallel would race against the same rows. One worker, no
  // per-file parallelism, keeps ordering deterministic.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,

  reporter: [["html", { open: "never" }]],

  use: {
    baseURL: `http://localhost:${PORT}`,
    // "trace-on-failure": keep the timeline (DOM snapshots, network,
    // console) only for tests that actually fail — free for passing runs.
    trace: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /legal-bump\.spec\.ts$/,
    },
    ...(withBumpServer
      ? [
          {
            name: "legal-bump",
            testMatch: /legal-bump\.spec\.ts$/,
            use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${BUMP_PORT}` },
          },
        ]
      : []),
  ],

  webServer: [
    {
      // CI tests a production build — what actually ships — because some
      // bugs only surface there: the invite-rotation test navigated before
      // its server action settled, which next dev's slower responses hid
      // and a production build exposed every time. Local runs stay on
      // next dev for fast iteration and React's dev-only warnings.
      // Calling next directly (not the npm scripts) so --port is
      // unambiguous — next dev's handling of the PORT env var has been
      // inconsistent across versions.
      command: process.env.CI
        ? `npx next build && npx next start --port ${PORT}`
        : `npx next dev --port ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      // The CI command includes a full build before the server listens.
      timeout: process.env.CI ? 300_000 : 60_000,
      env: SERVER_ENV,
    },
    ...(withBumpServer
      ? [
          {
            // The build above, served again with one difference.
            command: `npx next start --port ${BUMP_PORT}`,
            url: `http://localhost:${BUMP_PORT}`,
            reuseExistingServer: false,
            timeout: 60_000,
            env: { ...SERVER_ENV, KINOMATO_TEST_TERMS_VERSION: BUMPED_TERMS_VERSION },
          },
        ]
      : []),
  ],
});
