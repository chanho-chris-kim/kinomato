import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Enforces CLAUDE.md "Which films a club can see goes through one
// function": what a club sees of its members' watchlists is decided in one
// place (lib/watchlistVisibility.ts), and app/watchlistRead.ts is the only
// loader of other people's watchlist_items, passing everything through it.
// Per-club folders later change that function and that loader, nothing
// else — which only holds if nothing else reads the table.
//
// - app/watchlistRead.ts may read anyone's watchlist_items.
// - The own-list files may read and write the viewer's own rows.
// - Nothing else in app/ or lib/ may touch watchlist_items at all.

const ROOT = join(__dirname, "..");
const LOADER = "app/watchlistRead.ts";
const OWN_LIST = ["app/watchlist/page.tsx", "app/watchlist/actions.ts"];
const RULING =
  'CLAUDE.md "Which films a club can see goes through one function": only ' +
  `${LOADER} reads other people's watchlist_items (own-list files: ${OWN_LIST.join(", ")})`;

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

export function watchlistFindings(file: string, source: string): string[] {
  const src = code(source);
  const findings: string[] = [];
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'][^"']*db\/schema["']/g)) {
    const names = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, ""));
    if (names.includes("watchlistItems")) findings.push("imports `watchlistItems` from db/schema");
  }
  for (const m of src.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s*["'][^"']*db\/schema["']/g)) {
    if (new RegExp(`\\b${m[1]}\\.watchlistItems\\b`).test(src)) findings.push(`uses ${m[1]}.watchlistItems`);
  }
  if (/\bwatchlist_items\b/.test(src)) findings.push("names the watchlist_items table");
  return findings.map((f) => `${file}: ${f}`);
}

describe("watchlist access (what a club sees goes through one function)", () => {
  it("no file but the loader and the own-list files touches watchlist_items", () => {
    const violations = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "lib"))].flatMap((path) => {
      const file = relative(ROOT, path);
      return file === LOADER || OWN_LIST.includes(file) ? [] : watchlistFindings(file, readFileSync(path, "utf8"));
    });
    expect(violations, `${RULING}.\n${violations.join("\n")}`).toEqual([]);
  });

  it("the loader goes through visibleToClub", () => {
    const loader = code(readFileSync(join(ROOT, LOADER), "utf8"));
    expect(loader).toMatch(/visibleToClub\(/);
  });

  it("catches each way of reaching the table", () => {
    expect(watchlistFindings("x.ts", 'import { films, watchlistItems } from "@/db/schema";')).toHaveLength(1);
    expect(watchlistFindings("x.ts", 'import * as s from "../db/schema"; s.watchlistItems;')).toHaveLength(1);
    expect(watchlistFindings("x.ts", "sql`select * from watchlist_items`")).toHaveLength(1);
  });

  it("ignores comments", () => {
    expect(watchlistFindings("x.ts", "// reads watchlist_items via watchlistItems\n/* watchlist_items */")).toEqual([]);
  });
});
