import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Enforces docs/onboarding-spec.md §5.9's reminder ruling (2026-11-23): a
// reminder is claimed in notification_log before it's sent and released if
// it fails, so it goes at most once; rows are deleted after 30 days and
// with the account or the club. Only app/notificationLog.ts touches the
// table; everyone else goes through its functions.

const ROOT = join(__dirname, "..");
const MODULE = "app/notificationLog.ts";
const RULING = `docs/onboarding-spec.md §5.9 (reminders): only ${MODULE} touches notification_log`;

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

export function logTableFindings(file: string, source: string): string[] {
  const src = code(source);
  const findings: string[] = [];
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'][^"']*db\/schema["']/g)) {
    const names = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, ""));
    if (names.includes("notificationLog")) findings.push("imports `notificationLog` from db/schema");
  }
  for (const m of src.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s*["'][^"']*db\/schema["']/g)) {
    if (new RegExp(`\\b${m[1]}\\.notificationLog\\b`).test(src)) findings.push(`uses ${m[1]}.notificationLog`);
  }
  if (/\bnotification_log\b/.test(src)) findings.push("names the notification_log table");
  return findings.map((f) => `${file}: ${f}`);
}

describe("notification_log access", () => {
  it("only the log module touches the reminder log", () => {
    const violations = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "lib"))].flatMap((path) => {
      const file = relative(ROOT, path);
      return file === MODULE ? [] : logTableFindings(file, readFileSync(path, "utf8"));
    });
    expect(violations, `${RULING}.\n${violations.join("\n")}`).toEqual([]);
  });

  it("catches each way of reaching the table", () => {
    expect(logTableFindings("x.ts", 'import { notificationLog } from "@/db/schema";')).toHaveLength(1);
    expect(logTableFindings("x.ts", 'import * as s from "../db/schema"; s.notificationLog;')).toHaveLength(1);
    expect(logTableFindings("x.ts", "sql`select * from notification_log`")).toHaveLength(1);
    expect(logTableFindings("x.ts", "// notification_log in a comment")).toEqual([]);
  });
});
