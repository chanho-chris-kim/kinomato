// A night's deadlines (ruled 2026-11-21). Pure: the caller supplies "now".
//
// They're stored on the night, not recomputed from settings: lock_at when
// voting opens, unconfirm_at when it locks. So a settings change never
// moves a night already under way. Durations are absolute hours, not wall-
// clock time: across a DST change "24 hours before" is 23 or 25 hours on
// the clock, and a 48-hour window is 47 or 49.

import { confirmableAt, isConfirmable, type ConfirmAt } from "./confirmTiming";

const H = 3600_000;

// Everyone gets at least this long to vote, unless the night itself comes
// first.
export const MIN_VOTING_HOURS = 6;

// A late "Yes, we watched it" on an unconfirmed night (built later).
export const LATE_CONFIRM_DAYS = 7;

const plusHours = (d: Date, hours: number) => new Date(d.getTime() + hours * H);
const later = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b);
const earlier = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b);

// When voting closes, set when it opens:
// min(max(scheduled_at − lockTime, now + 6h), scheduled_at). Voting never
// closes after the night starts.
export function lockAtFor(input: { scheduledAt: Date; now: Date; lockTimeHours: number }): Date {
  const byLockTime = plusHours(input.scheduledAt, -input.lockTimeHours);
  return earlier(later(byLockTime, plusHours(input.now, MIN_VOTING_HOURS)), input.scheduledAt);
}

// When a draft whose picker never opened voting has its turn passed:
// when voting would have closed, lockTime before the night.
export function autoPassAtFor(input: { scheduledAt: Date; lockTimeHours: number }): Date {
  return plusHours(input.scheduledAt, -input.lockTimeHours);
}

// When a locked night nobody confirms is logged as unconfirmed, set at
// lock: autoAdvance after the prompt appears (or the night, when the
// prompt has no time gate), or after the lock if that came later.
export function unconfirmAtFor(input: {
  confirmAt: ConfirmAt;
  scheduledAt: Date;
  timezone: string;
  lockedAt: Date;
  autoAdvanceHours: number;
}): Date {
  const prompt = confirmableAt(input.confirmAt, input.scheduledAt, input.timezone) ?? input.scheduledAt;
  return plusHours(later(prompt, input.lockedAt), input.autoAdvanceHours);
}

// Whether a late "Yes, we watched it" is still accepted: for 7 days after
// the night became unconfirmed, and only while no later night has
// finished. (A late "No" never is.)
export function lateConfirmOpen(input: {
  unconfirmedAt: Date | null;
  now: Date;
  laterNightFinished: boolean;
}): boolean {
  if (!input.unconfirmedAt || input.laterNightFinished) return false;
  return input.now.getTime() < input.unconfirmedAt.getTime() + LATE_CONFIRM_DAYS * 24 * H;
}

// ---- What the hourly job acts on (app/weeklyLoop.ts, w3) ----
// The stored deadline when there is one. Nights from before deadlines were
// stored get the same fallback Tonight shows: lockTime before the night,
// and autoAdvance after the prompt (or after the lock, or the night).

export function effectiveLockAt(night: { lockAt: Date | null; scheduledAt: Date; lockTimeHours: number }): Date {
  return night.lockAt ?? autoPassAtFor(night);
}

export function effectiveUnconfirmAt(night: {
  unconfirmAt: Date | null;
  confirmAt: ConfirmAt;
  scheduledAt: Date;
  timezone: string;
  lockedAt: Date | null;
  autoAdvanceHours: number;
}): Date {
  return night.unconfirmAt ?? unconfirmAtFor({ ...night, lockedAt: night.lockedAt ?? night.scheduledAt });
}

// Open nights whose voting deadline has come, oldest deadline first (then
// id), at most `cap` of them: the rest wait for the next run, which is safe
// because every lock waits on the night still being open.
export function dueToLock<N extends { id: string; lockAt: Date | null; scheduledAt: Date; lockTimeHours: number }>(
  nights: N[],
  now: Date,
  cap: number,
): N[] {
  return nights
    .map((n) => ({ n, at: effectiveLockAt(n).getTime() }))
    .filter(({ at }) => at <= now.getTime())
    .sort((a, b) => a.at - b.at || (a.n.id < b.n.id ? -1 : a.n.id > b.n.id ? 1 : 0))
    .slice(0, cap)
    .map(({ n }) => n);
}

// A locked night is logged unconfirmed once its deadline has come, and
// never before the "did you watch it?" prompt has appeared under the
// club's current settings: a deadline stored before the prompt moved later
// waits for the prompt.
export function dueToUnconfirm(
  night: Parameters<typeof effectiveUnconfirmAt>[0],
  now: Date,
): boolean {
  return (
    effectiveUnconfirmAt(night).getTime() <= now.getTime() &&
    isConfirmable(night.confirmAt, night.scheduledAt, night.timezone, now)
  );
}

// A draft nobody opened has its turn passed once voting would have closed.
export function dueToAutoPass(draft: { scheduledAt: Date; lockTimeHours: number }, now: Date): boolean {
  return autoPassAtFor(draft).getTime() <= now.getTime();
}
