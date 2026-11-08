import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Enforces docs/onboarding-spec.md §11.4 (ruled 2026-11-07): the deletion
// code lives in account_deletion_requests, "which sign-in can never
// consume". Only app/accountDeletion.ts touches that table, and sign-in
// (app/signIn.ts, app/login/*, app/verify/*) imports nothing from it.

const ROOT = join(__dirname, "..");
const MODULE = "app/accountDeletion.ts";
const SIGN_IN = (file: string) =>
  file === "app/signIn.ts" || file.startsWith("app/login/") || file.startsWith("app/verify/");
const RULING =
  "docs/onboarding-spec.md §11.4 (Delete account): only " +
  `${MODULE} touches account_deletion_requests, and sign-in never reads it`;

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

export function accountDeletionFindings(file: string, source: string): string[] {
  const src = code(source);
  const findings: string[] = [];
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'][^"']*db\/schema["']/g)) {
    const names = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, ""));
    if (names.includes("accountDeletionRequests")) findings.push("imports `accountDeletionRequests` from db/schema");
  }
  for (const m of src.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s*["'][^"']*db\/schema["']/g)) {
    if (new RegExp(`\\b${m[1]}\\.accountDeletionRequests\\b`).test(src)) {
      findings.push(`uses ${m[1]}.accountDeletionRequests`);
    }
  }
  if (/\baccount_deletion_requests\b/.test(src)) findings.push("names the account_deletion_requests table");
  if (SIGN_IN(file) && /from\s*["'][^"']*accountDeletion["']/.test(src)) {
    findings.push("sign-in imports from the account-deletion module");
  }
  return findings.map((f) => `${file}: ${f}`);
}

describe("account_deletion_requests access (sign-in can never consume a deletion code)", () => {
  it("only the account-deletion module touches account_deletion_requests; sign-in imports nothing from it", () => {
    const violations = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "lib"))].flatMap((path) => {
      const file = relative(ROOT, path);
      return file === MODULE ? [] : accountDeletionFindings(file, readFileSync(path, "utf8"));
    });
    expect(violations, `${RULING}.\n${violations.join("\n")}`).toEqual([]);
  });

  it("catches the ways in", () => {
    expect(accountDeletionFindings("app/x.ts", 'import { accountDeletionRequests } from "@/db/schema";')).toHaveLength(1);
    expect(
      accountDeletionFindings("app/x.ts", 'import * as s from "../db/schema";\ns.accountDeletionRequests;'),
    ).toHaveLength(1);
    expect(accountDeletionFindings("lib/x.ts", "sql`select * from account_deletion_requests`")).toHaveLength(1);
    expect(
      accountDeletionFindings("app/login/code/actions.ts", 'import { confirmAccountDeletion } from "@/app/accountDeletion";'),
    ).toHaveLength(1);
    expect(accountDeletionFindings("app/x.ts", "// account_deletion_requests in a comment")).toEqual([]);
    expect(accountDeletionFindings("app/settings/actions.ts", 'import { cancelAccountDeletion } from "@/app/accountDeletion";')).toEqual([]);
  });
});
