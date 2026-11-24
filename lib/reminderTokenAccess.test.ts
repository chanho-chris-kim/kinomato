import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Enforces docs/onboarding-spec.md §5.9's unsubscribe-link ruling
// (2026-11-23): a link's token is stored only as its hash, acts only on its
// own person and club, and is deleted after 90 days. Only
// app/reminderUnsubscribe.ts touches reminder_unsubscribe_tokens; everyone
// else goes through its functions.

const ROOT = join(__dirname, "..");
const MODULE = "app/reminderUnsubscribe.ts";
const RULING = `docs/onboarding-spec.md §5.9 (unsubscribe links): only ${MODULE} touches reminder_unsubscribe_tokens`;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

export function tokenTableFindings(file: string, source: string): string[] {
  const src = code(source);
  const findings: string[] = [];
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'][^"']*db\/schema["']/g)) {
    const names = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, ""));
    if (names.includes("reminderUnsubscribeTokens")) findings.push("imports `reminderUnsubscribeTokens` from db/schema");
  }
  for (const m of src.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s*["'][^"']*db\/schema["']/g)) {
    if (new RegExp(`\\b${m[1]}\\.reminderUnsubscribeTokens\\b`).test(src)) findings.push(`uses ${m[1]}.reminderUnsubscribeTokens`);
  }
  if (/\breminder_unsubscribe_tokens\b/.test(src)) findings.push("names the reminder_unsubscribe_tokens table");
  return findings.map((f) => `${file}: ${f}`);
}

describe("reminder_unsubscribe_tokens access", () => {
  it("only the unsubscribe module touches the token table", () => {
    const violations = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "lib"))].flatMap((path) => {
      const file = relative(ROOT, path);
      return file === MODULE ? [] : tokenTableFindings(file, readFileSync(path, "utf8"));
    });
    expect(violations, `${RULING}.\n${violations.join("\n")}`).toEqual([]);
  });

  it("catches each way of reaching the table", () => {
    expect(tokenTableFindings("x.ts", 'import { reminderUnsubscribeTokens } from "@/db/schema";')).toHaveLength(1);
    expect(tokenTableFindings("x.ts", 'import * as s from "../db/schema"; s.reminderUnsubscribeTokens;')).toHaveLength(1);
    expect(tokenTableFindings("x.ts", "sql`select * from reminder_unsubscribe_tokens`")).toHaveLength(1);
    expect(tokenTableFindings("x.ts", "// reminder_unsubscribe_tokens in a comment")).toEqual([]);
  });
});
