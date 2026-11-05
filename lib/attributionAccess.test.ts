import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Enforces CLAUDE.md's "Attribution is retained, never deleted — access is
// the control": votes.membership_id and vetoes.membership_id are kept
// forever, and the one thing standing between them and the History page is
// that only the history-read module reads those tables. This scan makes
// that a failing test, not a reminder.
//
// - The history-read module may read votes and vetoes.
// - The club's server actions may import them, to write (cast or move a
//   vote, cast a veto), but never read them.
// - Nothing else in app/ or lib/ may import them from db/schema, reach them
//   through a namespace import, or name them in SQL.

const ROOT = join(__dirname, "..");
const HISTORY_READ = "app/clubs/[clubId]/historyRead.ts";
const WRITERS = ["app/clubs/[clubId]/actions.ts"];
const RULING =
  'CLAUDE.md "Attribution is retained, never deleted — access is the control": only ' +
  `${HISTORY_READ} reads the votes and vetoes tables`;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

// Comments can say "votes" freely; only code counts.
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

export function attributionFindings(file: string, source: string): string[] {
  const src = code(source);
  const findings: string[] = [];
  const schemaImport = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'][^"']*db\/schema["']/g;
  for (const m of src.matchAll(schemaImport)) {
    const names = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, ""));
    for (const table of ["votes", "vetoes"]) {
      if (names.includes(table)) findings.push(`imports \`${table}\` from db/schema`);
    }
  }
  const namespace = /import\s+\*\s+as\s+(\w+)\s+from\s*["'][^"']*db\/schema["']/g;
  for (const m of src.matchAll(namespace)) {
    if (new RegExp(`\\b${m[1]}\\.(votes|vetoes)\\b`).test(src)) findings.push(`uses ${m[1]}.votes/vetoes`);
  }
  if (/\b(from|join|into|update|table)\s+"?(votes|vetoes)"?\b/i.test(src)) {
    findings.push("names the votes or vetoes table in SQL");
  }
  if (/\.(from|innerJoin|leftJoin|rightJoin|fullJoin)\(\s*(votes|vetoes)\b/.test(src)) {
    findings.push("reads the votes or vetoes table");
  }
  return findings.map((f) => `${file}: ${f}`);
}

describe("attribution access (only the history-read module reads votes and vetoes)", () => {
  it("no file outside the history-read module reads votes or vetoes", () => {
    const violations = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "lib"))].flatMap((path) => {
      const file = relative(ROOT, path);
      if (file === HISTORY_READ) return [];
      const findings = attributionFindings(file, readFileSync(path, "utf8"));
      // Writers may import the tables; they still may not read them.
      return WRITERS.includes(file) ? findings.filter((f) => f.endsWith("reads the votes or vetoes table")) : findings;
    });
    expect(violations, `${RULING}.\n${violations.join("\n")}`).toEqual([]);
  });

  it("the history-read module exists (the scan is meaningless without it)", () => {
    expect(statSync(join(ROOT, HISTORY_READ)).isFile()).toBe(true);
  });

  // The scan itself, on small samples, so a regex change can't quietly
  // stop catching things.
  it("catches each way of reaching the tables", () => {
    expect(attributionFindings("x.ts", 'import { nights, votes } from "@/db/schema";')).toHaveLength(1);
    expect(attributionFindings("x.ts", 'import { vetoes as v } from "../db/schema";')).toHaveLength(1);
    expect(attributionFindings("x.ts", 'import * as s from "@/db/schema"; s.votes;')).toHaveLength(1);
    expect(attributionFindings("x.ts", "sql`select * from votes`")).toHaveLength(1);
    expect(attributionFindings("x.ts", "db.select().from(votes)")).toHaveLength(1);
    expect(attributionFindings("x.ts", "q.innerJoin(vetoes, on)")).toHaveLength(1);
  });

  it("ignores comments and ordinary words", () => {
    expect(attributionFindings("x.ts", "// read from votes here\nconst label = `${n} votes`;")).toEqual([]);
    expect(attributionFindings("x.ts", "/* import { votes } from '@/db/schema' */")).toEqual([]);
  });
});
