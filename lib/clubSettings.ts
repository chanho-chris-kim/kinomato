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
import { parseCalendarDate } from "./schedule";

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

// Night deadlines (ruled 2026-11-21, lib/nightDeadlines.ts), stored as
// hours. lockTime: how long before the night voting closes. autoAdvance:
// how long after the "did you watch it?" prompt a night nobody answered is
// logged as unconfirmed. Never "never" (CLAUDE.md: a club stalled forever
// on one picker is a dead club). Read when they're written onto a night,
// so a change never moves a night already under way.
export const LOCK_TIME_HOURS = [1, 3, 6, 12, 24, 48, 72] as const;
export const AUTO_ADVANCE_HOURS = [24, 48, 168] as const;
const DEFAULT_LOCK_TIME = 24;
const DEFAULT_AUTO_ADVANCE = 48;

function readHours(settings: unknown, key: string, allowed: readonly number[], fallback: number): number {
  if (typeof settings !== "object" || settings === null) return fallback;
  const value = (settings as Record<string, unknown>)[key];
  return typeof value === "number" && allowed.includes(value) ? value : fallback;
}

export function getLockTime(settings: unknown): number {
  return readHours(settings, "lockTime", LOCK_TIME_HOURS, DEFAULT_LOCK_TIME);
}

export function getAutoAdvance(settings: unknown): number {
  return readHours(settings, "autoAdvance", AUTO_ADVANCE_HOURS, DEFAULT_AUTO_ADVANCE);
}

// ---- Write side ("How this club runs", docs/onboarding-spec.md §5.10) ----

export interface WritableClubSettings {
  nomineesPerTurn: number;
  confirmAt: ConfirmAt;
  lockTime: number;
  autoAdvance: number;
}

// A form value that must be one of `allowed`, as whole digits.
function formHours(value: unknown, allowed: readonly number[]): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const hours = Number(value);
  return allowed.includes(hours) ? hours : null;
}

// The form's raw values, validated at write time: anything the readers
// above would have to fall back on is refused here instead, with a
// message for the ?error= convention. Fixed strings, never echoing input.
export function readClubSettingsForm(fields: {
  nomineesPerTurn: unknown;
  confirmAt: unknown;
  lockTime: unknown;
  autoAdvance: unknown;
}): { ok: true; settings: WritableClubSettings } | { ok: false; error: string } {
  const raw = typeof fields.nomineesPerTurn === "string" ? fields.nomineesPerTurn.trim() : "";
  const nominees = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(nominees >= MIN_NOMINEES_PER_TURN && nominees <= MAX_NOMINEES_PER_TURN)) {
    return { ok: false, error: "Films each picker nominates must be a whole number from 1 to 5." };
  }
  const confirmAt = fields.confirmAt;
  if (typeof confirmAt !== "string" || !IMPLEMENTED_CONFIRM_AT.includes(confirmAt as ConfirmAt)) {
    return { ok: false, error: "Pick when to ask whether you watched it." };
  }
  const lockTime = formHours(fields.lockTime, LOCK_TIME_HOURS);
  if (lockTime === null) return { ok: false, error: "Pick when voting closes." };
  const autoAdvance = formHours(fields.autoAdvance, AUTO_ADVANCE_HOURS);
  if (autoAdvance === null) return { ok: false, error: "Pick when to log a night nobody confirmed." };
  return { ok: true, settings: { nomineesPerTurn: nominees, confirmAt: confirmAt as ConfirmAt, lockTime, autoAdvance } };
}

// The stored settings with these keys replaced and every other key kept
// (the JSONB holds the whole admin-flexibility table, analysis-v2.md §2).
export function mergeClubSettings(existing: unknown, update: WritableClubSettings): Record<string, unknown> {
  const base = typeof existing === "object" && existing !== null && !Array.isArray(existing) ? existing : {};
  return { ...(base as Record<string, unknown>), ...update };
}

// "First night on" (ruled 2026-11-10): the date biweekly parity and
// monthly's Nth weekday count from, when set (lib/schedule.ts). Written
// only by the club details form, validated there (lib/clubDetails.ts);
// anything unreadable reads as absent, and the schedule falls back to the
// club's created_at.
export function getScheduleAnchor(settings: unknown): string | null {
  if (typeof settings !== "object" || settings === null) return null;
  const value = (settings as Record<string, unknown>).scheduleAnchor;
  return parseCalendarDate(value) ? (value as string) : null;
}
