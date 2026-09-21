// When the "did you watch X?" prompt becomes confirmable. Pure — no DB
// calls, no Date.now() (caller supplies "now"). analysis-v2.md §2's
// confirmAt setting documents five options; this session implements
// three of them ("2 days" and "off" aren't built — see CLAUDE.md's
// Open Questions).
//
// Reuses lib/schedule.ts's timezone-correct date math rather than
// adding raw hours to an instant — the whole point of that module's
// Intl-based resolution is that "9am local" means something different
// in UTC on either side of a DST transition, and naive hour math gets
// that wrong exactly on the boundary where it matters most.

import { addDays, localDateParts, zonedTimeToUtc } from "./schedule";

export type ConfirmAt = "morning_after" | "same_night" | "manual_only";

const MORNING_AFTER_TIME = { hour: 9, minute: 0 };

// null means "no time gate" (manual_only) — always confirmable, not
// "confirmable at instant zero." isConfirmable is what callers should
// actually branch on; this is exposed separately because the UI may
// want to show the threshold itself ("confirmable from 9am tomorrow").
export function confirmableAt(
  confirmAt: ConfirmAt,
  scheduledAt: Date,
  timezone: string,
): Date | null {
  switch (confirmAt) {
    case "same_night":
      return scheduledAt;
    case "morning_after": {
      const nextDay = addDays(localDateParts(scheduledAt, timezone), 1);
      return zonedTimeToUtc(nextDay, MORNING_AFTER_TIME, timezone);
    }
    case "manual_only":
      // No automatic timing gate at all — confirmable purely at the
      // club's discretion, whenever someone chooses to act, distinct
      // from "same_night" (which still waits for the night itself) and
      // "morning_after" (which waits longer still).
      return null;
  }
}

export function isConfirmable(
  confirmAt: ConfirmAt,
  scheduledAt: Date,
  timezone: string,
  now: Date,
): boolean {
  const threshold = confirmableAt(confirmAt, scheduledAt, timezone);
  return threshold === null || now.getTime() >= threshold.getTime();
}
