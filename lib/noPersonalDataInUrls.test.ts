import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Enforces docs/onboarding-spec.md §11.6 "Emails out of URLs" (and names
// with them): Workers Logs keep every request URL, so nothing personal may
// ride in one. The address someone signs in with is held in the sign-in
// cookie (app/signInCookie.ts); what was typed into a form comes back
// through the form-echo cookie (app/formEcho.ts). Fails if any code in
// app/ or lib/ builds a query with a personal key, writes one into a URL
// string, or interpolates a personal value into a path.

const ROOT = join(__dirname, "..");
const RULING =
  "docs/onboarding-spec.md §11.6 (no personal data in URLs: Workers Logs keep every URL; " +
  "use app/signInCookie.ts or app/formEcho.ts)";
// Limits and preferences are sensitive too (ruled 2026-11-12): no genre,
// keyword, label or length may ride in a URL either.
const KEYS = ["email", "first", "initial", "name", "newEmail", "genre", "keyword", "label", "minutes"];
// Values that are personal when interpolated into a path: these as bare
// names, and the first four also as properties (`link.email`), but not
// `.name` (a tag's or a club's name is the club's, not a person's).
const PROPERTIES = ["email", "newEmail", "displayName", "inviteeName"];
const BARE = [...PROPERTIES, "firstName", "lastInitial", "first", "initial", "name"];

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

const key = `(?:${KEYS.join("|")})`;
const value = `(?:\\.(?:${PROPERTIES.join("|")})|(?<![.\\w])(?:${BARE.join("|")}))\\b`;
// Inside ${…}, a quoted string is a fixed message, not a value.
const withoutStrings = (expr: string) => expr.replace(/"[^"]*"|'[^']*'/g, '""');

export function personalUrlFindings(file: string, source: string): string[] {
  const src = code(source);
  const findings: string[] = [];
  // new URLSearchParams({ email }) or ({ first: firstName, ... })
  for (const m of src.matchAll(/new\s+URLSearchParams\s*\(\s*\{([^}]*)\}/g)) {
    for (const k of m[1].matchAll(new RegExp(`(?:^|[,{\\s])["']?(${key})["']?\\s*(?=[:,}]|$)`, "g"))) {
      findings.push(`URLSearchParams with key "${k[1]}"`);
    }
  }
  // qs.set("email", …) / .append("first", …)
  for (const m of src.matchAll(new RegExp(`\\.(?:set|append)\\(\\s*["'\`](${key})["'\`]`, "g"))) {
    findings.push(`query key "${m[1]}" set`);
  }
  // "/login?email=…", `…&first=${…}`
  for (const m of src.matchAll(new RegExp(`["'\`][^"'\`\\n]*[?&](${key})=`, "g"))) {
    findings.push(`URL string with "${m[1]}="`);
  }
  // `/somewhere/${email}` in a path
  for (const t of src.matchAll(/`\/[^`]*`/g)) {
    for (const e of t[0].matchAll(/\$\{([^}]*)\}/g)) {
      const hit = withoutStrings(e[1]).match(new RegExp(value));
      if (hit) findings.push(`personal value "${hit[0].replace(/^\./, "")}" interpolated into a path`);
    }
  }
  return findings.map((f) => `${file}: ${f}`);
}

describe("no personal data in URLs (§11.6)", () => {
  it("nothing in app/ or lib/ puts an email or a name in a URL", () => {
    const violations = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "lib"))].flatMap((path) =>
      personalUrlFindings(relative(ROOT, path), readFileSync(path, "utf8")),
    );
    expect(violations, `${RULING}.\n${violations.join("\n")}`).toEqual([]);
  });

  it("catches each kind of offender, and leaves paths and fixed messages alone", () => {
    const offenders = [
      "const qs = new URLSearchParams({ email });",
      'const qs = new URLSearchParams({ error, first: firstName, initial: lastInitial });',
      'qs.set("newEmail", newEmail);',
      'qs.append("name", inviteeName);',
      "const qs = new URLSearchParams({ genre: limit.value });",
      'redirect(`/clubs/x/members?label=${limit.label}`);',
      "redirect(`/login?email=${encodeURIComponent(email)}`);",
      'const retry = "/login/code?x=1&email=" + email;',
      "redirect(`/people/${user.displayName}`);",
      "<Link href={`/welcome/${firstName}`} />",
    ];
    for (const line of offenders) {
      expect(personalUrlFindings("app/fixture.ts", line), line).not.toEqual([]);
    }
    const fine = [
      "const qs = new URLSearchParams({ next, error: result.error });",
      'qs.set("returnTo", returnTo);',
      "redirect(`/clubs/${clubId}/tags/${encodeURIComponent(t.name)}`);",
      "redirect(`/invite/${token}?error=${encodeURIComponent(message)}`);",
      'redirect(`/invite/${token}?error=${encodeURIComponent("Enter a valid email address.")}`);',
      '// redirect(`/login?email=${email}`) in a comment',
      'const label = "Your email";',
    ];
    for (const line of fine) {
      expect(personalUrlFindings("app/fixture.ts", line), line).toEqual([]);
    }
  });
});
