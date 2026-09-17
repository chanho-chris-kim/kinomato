import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // OpenNext Cloudflare build output and wrangler's local state — both
    // generated, neither meant to be linted or committed.
    ".open-next/**",
    ".wrangler/**",
    // Playwright's own generated output (HTML report, traces, test
    // artifacts) — same story, generated and gitignored, not source.
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
