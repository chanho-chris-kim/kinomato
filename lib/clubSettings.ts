// Pure. No DB calls.
//
// clubs.settings is one JSONB blob (CLAUDE.md Conventions: "not eight
// nullable fields") holding the admin-flexibility table from
// analysis-v2.md §2. The column is untyped JSONB with no runtime
// validation at the write boundary yet (nothing writes to it besides
// db/seed.ts's default {} today), so these defend against anything:
// missing, wrong type, out of range, or — for confirmAt — a value this
// session hasn't implemented.

import type { ConfirmAt } from "./confirmTiming";

const DEFAULT_NOMINEES_PER_TURN = 3;
const MIN_NOMINEES_PER_TURN = 1;
const MAX_NOMINEES_PER_TURN = 5;

export function getNomineesPerTurn(settings: unknown): number {
  if (typeof settings !== "object" || settings === null) {
    return DEFAULT_NOMINEES_PER_TURN;
  }
  const value = (settings as Record<string, unknown>).nomineesPerTurn;
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_NOMINEES_PER_TURN &&
    value <= MAX_NOMINEES_PER_TURN
  ) {
    return value;
  }
  return DEFAULT_NOMINEES_PER_TURN;
}

const DEFAULT_CONFIRM_AT: ConfirmAt = "morning_after";
const IMPLEMENTED_CONFIRM_AT: ConfirmAt[] = ["morning_after", "same_night", "manual_only"];

// analysis-v2.md §2 documents five confirmAt options; only three are
// built this session (CLAUDE.md's Open Questions covers "2 days" and
// "off"). A club whose settings somehow already name one of those two —
// or anything else unrecognized — falls back to the default rather than
// the page breaking on an unimplemented mode.
export function getConfirmAt(settings: unknown): ConfirmAt {
  if (typeof settings !== "object" || settings === null) {
    return DEFAULT_CONFIRM_AT;
  }
  const value = (settings as Record<string, unknown>).confirmAt;
  if (
    typeof value === "string" &&
    IMPLEMENTED_CONFIRM_AT.includes(value as ConfirmAt)
  ) {
    return value as ConfirmAt;
  }
  return DEFAULT_CONFIRM_AT;
}
