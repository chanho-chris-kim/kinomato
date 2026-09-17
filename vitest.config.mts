import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Scoped explicitly rather than excluding e2e/ from the default
    // pattern — unit tests only ever live in lib/, per CLAUDE.md's
    // Conventions. Without this, Vitest's default *.spec.ts pattern
    // also picks up Playwright's e2e/voting-flow.spec.ts and collides
    // with its test.describe.configure() call.
    include: ["lib/**/*.test.ts"],
  },
});
