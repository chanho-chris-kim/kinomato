import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// worker.ts bundles its scheduled jobs' import graph outside Next's bundle
// (CLAUDE.md Stack: "keep that import graph small"), so nothing reachable
// from it may import Next.js or React: their runtime isn't there, and a
// second copy bloats the Worker. Walks every static import from worker.ts,
// except OpenNext's own generated worker, and fails naming the chain.

const ROOT = resolve(__dirname, "..");
const FORBIDDEN = /^(next|react|react-dom|server-only)(\/|$)/;

function resolveLocal(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(ROOT, spec.slice(2)) : resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate) && candidate.match(/\.tsx?$/)) return candidate;
  }
  return null;
}

// Value imports only: `import type` is erased before bundling.
function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/^(import|export)\s(?!type\s)[^;]*?\sfrom\s+"([^"]+)"/gm)].map((m) => m[2]);
}

describe("the Worker's scheduled-job import graph", () => {
  it("never reaches Next.js or React", () => {
    const seen = new Set<string>();
    const problems: string[] = [];
    const walk = (file: string, chain: string[]) => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const spec of importsOf(file)) {
        if (spec.includes(".open-next/")) continue;
        if (FORBIDDEN.test(spec)) problems.push([...chain, file.replace(`${ROOT}/`, ""), spec].join(" → "));
        if (spec.startsWith(".") || spec.startsWith("@/")) {
          const next = resolveLocal(file, spec);
          if (next) walk(next, [...chain, file.replace(`${ROOT}/`, "")]);
        }
      }
    };
    walk(join(ROOT, "worker.ts"), []);
    expect(seen.size).toBeGreaterThan(5);
    expect([...seen].map((f) => f.replace(`${ROOT}/`, ""))).toEqual(
      expect.arrayContaining(["app/weeklyLoop.ts", "app/clubs/[clubId]/lockNightCore.ts", "app/clubs/[clubId]/passTurnCore.ts", "lib/email.ts"]),
    );
    expect(problems, "the Worker's scheduled graph imports Next.js or React").toEqual([]);
  });
});
