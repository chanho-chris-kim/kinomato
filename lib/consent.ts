import type { Legal } from "./legal";

// Consent, age and the data-licensing opt-in (docs/onboarding-spec.md
// §11.1–§11.3), as pure functions over the rows. Both tables are
// append-only: the current state is always read from the newest rows,
// never stored as a flag.

export type LegalDocumentName = "terms" | "privacy";
export type AgeBracket = "13_17" | "18_plus";
// "under_13" is a form answer only — never stored (§11.3).
export type AgeChoice = AgeBracket | "under_13";
export type ConsentGap = LegalDocumentName | "age";

export interface ConsentEventLike {
  document: LegalDocumentName;
  version: string;
  acceptedAt: Date;
}

function newest<T>(rows: T[], at: (row: T) => Date): T | undefined {
  return rows.reduce<T | undefined>((best, row) => (!best || at(row) > at(best) ? row : best), undefined);
}

// What an account still has to give before any signed-in page: each
// document whose newest acceptance isn't its current version, and its age
// if it was never asked. Empty means through.
export function needsConsent(
  user: { ageBracket: AgeBracket | null },
  events: ConsentEventLike[],
  legal: Pick<Legal, "terms" | "privacy">,
): ConsentGap[] {
  const gaps: ConsentGap[] = [];
  for (const document of ["terms", "privacy"] as const) {
    const latest = newest(
      events.filter((e) => e.document === document),
      (e) => e.acceptedAt,
    );
    if (latest?.version !== legal[document].version) gaps.push(document);
  }
  if (!user.ageBracket) gaps.push("age");
  return gaps;
}

// signup for a document's first-ever acceptance; reconsent once there's
// an earlier one (a version change).
export function acceptanceMethod(events: ConsentEventLike[], document: LegalDocumentName): "signup" | "reconsent" {
  return events.some((e) => e.document === document) ? "reconsent" : "signup";
}

export function parseAgeChoice(value: unknown): AgeChoice | null {
  return value === "13_17" || value === "18_plus" || value === "under_13" ? value : null;
}

// 13–17s can't opt in (§11.2), and nor can an account never asked.
export function canOptInToLicensing(ageBracket: AgeBracket | null): boolean {
  return ageBracket === "18_plus";
}

export interface LicensingRowLike {
  wordingVersion: string;
  optedInAt: Date;
  withdrawnAt: Date | null;
}

export interface LicensingStatus {
  optedIn: boolean;
  wordingVersion: string | null;
  since: Date | null;
  withdrawnAt: Date | null;
}

// The newest opt-in row decides: open means in, withdrawn means out.
export function currentLicensing(rows: LicensingRowLike[]): LicensingStatus {
  const latest = newest(rows, (r) => r.optedInAt);
  if (!latest) return { optedIn: false, wordingVersion: null, since: null, withdrawnAt: null };
  return {
    optedIn: latest.withdrawnAt === null,
    wordingVersion: latest.wordingVersion,
    since: latest.optedInAt,
    withdrawnAt: latest.withdrawnAt,
  };
}

// Whether this account's data may go into an aggregate now: opted in, on
// the wording currently shown, and 18 or older.
export function isLicensingActive(
  rows: LicensingRowLike[],
  ageBracket: AgeBracket | null,
  currentWordingVersion: string,
): boolean {
  const status = currentLicensing(rows);
  return canOptInToLicensing(ageBracket) && status.optedIn && status.wordingVersion === currentWordingVersion;
}

export type ConsentFormResult =
  | { kind: "error"; error: string }
  | { kind: "under_13" }
  | { kind: "ok"; age: AgeBracket | null; licensing: boolean };

// The consent form's fields (/welcome, /consent). "Under 13" comes first:
// that answer ends the form whatever else was ticked. `age` is null when
// the form didn't ask (an account already asked once); the Terms box is
// required only when the form showed it (a document is out of date).
export function readConsentForm(
  fields: { age?: unknown; terms?: unknown; licensing?: unknown },
  asked: { age: boolean; terms: boolean },
): ConsentFormResult {
  const age = asked.age ? parseAgeChoice(fields.age) : null;
  if (asked.age && !age) return { kind: "error", error: "Choose your age." };
  if (age === "under_13") return { kind: "under_13" };
  if (asked.terms && fields.terms !== "on") {
    return { kind: "error", error: "To use Kinomato, agree to the Terms and the Privacy policy." };
  }
  return { kind: "ok", age, licensing: fields.licensing === "on" };
}
