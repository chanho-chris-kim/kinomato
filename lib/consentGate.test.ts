import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Enforces docs/onboarding-spec.md §11.1: "any version change of either
// document blocks every signed-in page until it's re-accepted", and §11.3's
// age, asked once. The check lives in app/auth.ts's gates; this makes sure
// nothing signed-in can go round them. Every page or route handler, and
// every exported server action, outside the exempt routes calls one of the
// gates. The session-only check that skips consent is allowed only where
// the gate itself sends people, and in the sign-out actions.

const ROOT = join(__dirname, "..");
const RULING = "docs/onboarding-spec.md §11.1/§11.3: every signed-in route goes through app/auth.ts's consent gate";

// Reachable with consent pending: the legal pages, the consent screens
// themselves, the sign-in flow, the invite landing, where "Under 13"
// lands, and where Delete account lands (signed out by then).
const EXEMPT_ROUTES = [
  "app/terms/",
  "app/privacy/",
  "app/consent/",
  "app/welcome/",
  "app/login/",
  "app/verify/",
  "app/invite/",
  "app/age-limit/",
  "app/account-deleted/",
];
// Sign out works whatever the consent state, so nobody is trapped.
const EXEMPT_ACTIONS = ["app/settings/actions.ts#signOut", "app/settings/actions.ts#signOutEverywhere"];
const GATE_NAMES = ["requireUser", "requireNamedUser", "requireClubMember", "requireCurrentMembershipId"];
const UNGATED = /\brequireSignedInIgnoringConsent\b/;

const exempt = (file: string) => EXEMPT_ROUTES.some((prefix) => file.startsWith(prefix));

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

const isRouteEntry = (file: string) => /\/(page|route|opengraph-image|twitter-image)\.tsx?$/.test(file);
const isServerActions = (src: string) => /^\s*["']use server["']/.test(src);

// Each top-level function and its body, up to the next top-level one.
function functions(src: string): { name: string; exported: boolean; body: string }[] {
  const starts = [...src.matchAll(/^(export\s+)?(?:async\s+)?function\s+(\w+)/gm)];
  return starts.map((m, i) => ({
    name: m[2],
    exported: Boolean(m[1]),
    body: src.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : undefined),
  }));
}

// The gates, plus any helper in the same file that calls one (an action
// file's requireOwnerOrAdmin, say), followed until nothing new is found.
function gateIn(fns: { name: string; body: string }[]): RegExp {
  const names = new Set(GATE_NAMES);
  let grew = true;
  while (grew) {
    grew = false;
    const gate = new RegExp(`\\b(${[...names].join("|")})\\s*\\(`);
    for (const fn of fns) {
      if (!names.has(fn.name) && gate.test(fn.body.slice(fn.body.indexOf("{")))) {
        names.add(fn.name);
        grew = true;
      }
    }
  }
  return new RegExp(`\\b(${[...names].join("|")})\\s*\\(`);
}

export function consentGateFindings(file: string, source: string): string[] {
  const src = code(source);
  const findings: string[] = [];
  if (!exempt(file)) {
    const fns = functions(src);
    const gate = gateIn(fns);
    if (isRouteEntry(file) && !gate.test(src)) findings.push("route never calls a consent gate");
    if (isServerActions(src)) {
      for (const fn of fns.filter((f) => f.exported)) {
        const key = `${file}#${fn.name}`;
        if (EXEMPT_ACTIONS.includes(key)) continue;
        if (!gate.test(fn.body.slice(fn.body.indexOf("{")))) {
          findings.push(`server action ${fn.name} never calls a consent gate`);
        }
        if (UNGATED.test(fn.body)) findings.push(`server action ${fn.name} skips consent`);
      }
    }
    if (UNGATED.test(src) && file !== "app/auth.ts" && !isServerActions(src)) {
      findings.push("skips consent outside the exempt routes");
    }
  }
  return findings.map((f) => `${file}: ${f}`);
}

describe("the consent gate (every signed-in route goes through it)", () => {
  it("every page, route and server action outside the exempt routes calls a gate", () => {
    const violations = sourceFiles(join(ROOT, "app")).flatMap((path) => {
      const file = relative(ROOT, path);
      return consentGateFindings(file, readFileSync(path, "utf8"));
    });
    expect(violations, `${RULING}.\n${violations.join("\n")}`).toEqual([]);
  });

  it("the exemptions name things that exist", () => {
    for (const prefix of EXEMPT_ROUTES) expect(existsSync(join(ROOT, prefix)), prefix).toBe(true);
    for (const key of EXEMPT_ACTIONS) {
      const [file, name] = key.split("#");
      expect(readFileSync(join(ROOT, file), "utf8")).toMatch(new RegExp(`export async function ${name}\\b`));
    }
  });

  it("flags an ungated page, an ungated action, and a skipped check", () => {
    expect(consentGateFindings("app/stats/page.tsx", "export default async function P() { return null; }")).toEqual([
      "app/stats/page.tsx: route never calls a consent gate",
    ]);
    // A gate named only in a comment doesn't count.
    expect(
      consentGateFindings("app/stats/page.tsx", "// requireUser(\nexport default async function P() { return null; }"),
    ).toHaveLength(1);
    expect(
      consentGateFindings(
        "app/stats/actions.ts",
        `"use server";\nexport async function a() { await requireUser("/x"); }\nexport async function b() { await getDb(); }`,
      ),
    ).toEqual(["app/stats/actions.ts: server action b never calls a consent gate"]);
    // A same-file helper that calls a gate counts; one that doesn't, doesn't.
    expect(
      consentGateFindings(
        "app/stats/actions.ts",
        `"use server";\nasync function guard() { return requireUser("/x"); }\nasync function noop() {}\n` +
          `export async function a() { await guard(); }\nexport async function b() { await noop(); }`,
      ),
    ).toEqual(["app/stats/actions.ts: server action b never calls a consent gate"]);
    expect(
      consentGateFindings(
        "app/stats/actions.ts",
        `"use server";\nexport async function a() { await requireSignedInIgnoringConsent("/x"); await requireUser("/x"); }`,
      ),
    ).toEqual(["app/stats/actions.ts: server action a skips consent"]);
    expect(consentGateFindings("app/stats/helper.ts", "requireSignedInIgnoringConsent('/x')")).toEqual([
      "app/stats/helper.ts: skips consent outside the exempt routes",
    ]);
    expect(consentGateFindings("app/login/page.tsx", "export default function P() {}")).toEqual([]);
  });
});
