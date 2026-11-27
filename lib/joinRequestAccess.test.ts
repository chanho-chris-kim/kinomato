import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Enforces the club-code rulings (u5, docs/onboarding-spec.md §5.13,
// details 2026-11-26): approvers see only a requester's display name, a
// pending request waits on the database's one-per-club index, and the
// lifecycle (export, deletion, retention) goes through one module. Only
// app/joinRequests.ts touches join_requests and join_code_attempts;
// everyone else goes through its functions.

const ROOT = join(__dirname, "..");
const MODULE = "app/joinRequests.ts";
const RULING = `docs/onboarding-spec.md §5.13 (club codes): only ${MODULE} touches join_requests and join_code_attempts`;
const TABLES = [
  ["joinRequests", "join_requests"],
  ["joinCodeAttempts", "join_code_attempts"],
] as const;

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

export function joinTableFindings(file: string, source: string): string[] {
  const src = code(source);
  const findings: string[] = [];
  for (const [name, table] of TABLES) {
    for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'][^"']*db\/schema["']/g)) {
      const names = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, ""));
      if (names.includes(name)) findings.push(`imports \`${name}\` from db/schema`);
    }
    for (const m of src.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s*["'][^"']*db\/schema["']/g)) {
      if (new RegExp(`\\b${m[1]}\\.${name}\\b`).test(src)) findings.push(`uses ${m[1]}.${name}`);
    }
    if (new RegExp(`\\b${table}\\b`).test(src)) findings.push(`names the ${table} table`);
  }
  return findings.map((f) => `${file}: ${f}`);
}

describe("join_requests and join_code_attempts access", () => {
  it("only the join-request module touches the two tables", () => {
    const violations = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "lib"))].flatMap((path) => {
      const file = relative(ROOT, path);
      return file === MODULE ? [] : joinTableFindings(file, readFileSync(path, "utf8"));
    });
    expect(violations, `${RULING}.\n${violations.join("\n")}`).toEqual([]);
  });

  it("catches each way of reaching either table", () => {
    expect(joinTableFindings("x.ts", 'import { joinRequests } from "@/db/schema";')).toHaveLength(1);
    expect(joinTableFindings("x.ts", 'import { clubs, joinCodeAttempts as a } from "../db/schema";')).toHaveLength(1);
    expect(joinTableFindings("x.ts", 'import * as s from "../db/schema"; s.joinRequests;')).toHaveLength(1);
    expect(joinTableFindings("x.ts", "sql`select * from join_requests`")).toHaveLength(1);
    expect(joinTableFindings("x.ts", "sql`delete from join_code_attempts`")).toHaveLength(1);
    expect(joinTableFindings("x.ts", "// join_requests in a comment")).toEqual([]);
    expect(joinTableFindings("x.ts", 'import { joinRequestStatusEnum } from "@/db/schema";')).toEqual([]);
  });
});
