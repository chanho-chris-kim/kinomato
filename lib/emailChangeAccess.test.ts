import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Enforces docs/onboarding-spec.md §5.9's email-change ruling: the change
// code lives in email_changes, "which sign-in can never consume". Only
// app/emailChange.ts touches that table. Sign-in (app/signIn.ts,
// app/login/*, app/verify/*) may call one thing from it,
// recentEmailChangeSendsTo, which returns send timestamps for the shared
// per-address limit and nothing else.

const ROOT = join(__dirname, "..");
const MODULE = "app/emailChange.ts";
const SIGN_IN = (file: string) =>
  file === "app/signIn.ts" || file.startsWith("app/login/") || file.startsWith("app/verify/");
const RULING =
  "docs/onboarding-spec.md §5.9 (email change): only " +
  `${MODULE} touches email_changes, and sign-in never reads it`;

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

export function emailChangeFindings(file: string, source: string): string[] {
  const src = code(source);
  const findings: string[] = [];
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'][^"']*db\/schema["']/g)) {
    const names = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, ""));
    if (names.includes("emailChanges")) findings.push("imports `emailChanges` from db/schema");
  }
  for (const m of src.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s*["'][^"']*db\/schema["']/g)) {
    if (new RegExp(`\\b${m[1]}\\.emailChanges\\b`).test(src)) findings.push(`uses ${m[1]}.emailChanges`);
  }
  if (/\bemail_changes\b/.test(src)) findings.push("names the email_changes table");
  if (SIGN_IN(file)) {
    for (const m of src.matchAll(/import\s+\{([^}]*)\}\s*from\s*["'][^"']*emailChange["']/g)) {
      const names = m[1].split(",").map((s) => s.trim()).filter(Boolean);
      for (const n of names) if (n !== "recentEmailChangeSendsTo") findings.push(`sign-in imports ${n} from the email-change module`);
    }
  }
  return findings.map((f) => `${file}: ${f}`);
}

describe("email_changes access (sign-in can never consume a change code)", () => {
  it("only the email-change module touches email_changes; sign-in takes timestamps only", () => {
    const violations = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "lib"))].flatMap((path) => {
      const file = relative(ROOT, path);
      return file === MODULE ? [] : emailChangeFindings(file, readFileSync(path, "utf8"));
    });
    expect(violations, `${RULING}.\n${violations.join("\n")}`).toEqual([]);
  });

  it("catches each way of reaching it", () => {
    expect(emailChangeFindings("x.ts", 'import { users, emailChanges } from "@/db/schema";')).toHaveLength(1);
    expect(emailChangeFindings("x.ts", 'import * as s from "../db/schema"; s.emailChanges;')).toHaveLength(1);
    expect(emailChangeFindings("x.ts", "sql`select * from email_changes`")).toHaveLength(1);
    expect(emailChangeFindings("app/signIn.ts", 'import { confirmEmailChange } from "@/app/emailChange";')).toHaveLength(1);
    expect(emailChangeFindings("app/signIn.ts", 'import { recentEmailChangeSendsTo } from "@/app/emailChange";')).toEqual([]);
  });

  it("ignores comments", () => {
    expect(emailChangeFindings("x.ts", "// email_changes via emailChanges\n/* email_changes */")).toEqual([]);
  });
});
