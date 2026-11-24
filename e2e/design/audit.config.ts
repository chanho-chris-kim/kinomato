import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import repo from "../../playwright.config";

// Design screenshots (`npm run audit:screens`), never part of the E2E run:
// the repo config's own production-build server and global setup (the E2E
// database only, wiped and seeded), and the one spec in this folder, whose
// name the E2E run's testMatch doesn't pick up. Output goes to
// design-audit/<AUDIT_LABEL>/ (gitignored), so a redesign step can shoot
// "before" on main and "after" on its branch and compare the pairs.
const ROOT = path.resolve(__dirname, "../..");
const servers = (Array.isArray(repo.webServer) ? repo.webServer : [repo.webServer]).slice(0, 1);

export default defineConfig({
  ...repo,
  testDir: __dirname,
  testMatch: /screens\.audit\.ts$/,
  globalSetup: path.join(ROOT, "e2e/global-setup.ts"),
  outputDir: path.join(ROOT, "test-results/audit"),
  projects: [{ name: "audit", use: { ...devices["Desktop Chrome"] } }],
  webServer: servers.map((w) => ({ ...w!, cwd: ROOT })),
  reporter: "line",
  workers: 1,
  retries: 0,
  timeout: 20 * 60_000,
});
