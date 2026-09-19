import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

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
    },
  ],

  webServer: {
    // Calling next directly (not the "dev" npm script) so --port is
    // unambiguous — next dev's handling of the PORT env var has been
    // inconsistent across versions.
    command: `npx next dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      // The app's own DATABASE_URL, deliberately overridden to the E2E
      // branch for the lifetime of this dev server — never
      // dev.kinomato.com's database. globalSetup already validated
      // E2E_DATABASE_URL is set.
      DATABASE_URL: process.env.E2E_DATABASE_URL!,
      // Explicitly cleared, not just left unset — a developer's own
      // .env has a real key for local `npm run dev`, and this webServer
      // env is merged onto (not a replacement for) the inherited
      // process.env, so without this override a local E2E run would
      // silently start hitting the real TMDB API. Empty string forces
      // lib/tmdb.ts's fixture fallback, same as CI (which never has a
      // key at all).
      TMDB_API_KEY: "",
    },
  },
});
