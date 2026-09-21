// When a club's next night happens. Pure — no DB calls, no Date.now()
// or Math.random() (caller supplies "now" and an anchor).
//
// DST correctness: this never adds raw milliseconds across a wall-clock
// gap. Every occurrence is computed as local calendar date + local
// time-of-day, resolved to a UTC instant via Intl.DateTimeFormat (the
// only reliable IANA-timezone source without a dependency) — so 8pm
// local stays 8pm local on both sides of a transition, at the cost of
// the UTC instant shifting by an hour, which is the correct behavior.
//
// "monthly" isn't in analysis-v1/v2 — this club-settings shape only has
// a day-of-week (default_day), not a day-of-month, so "same calendar
// day each month" isn't expressible. Interpreted as "the Nth occurrence
// of that weekday, same N every month" (e.g. the 2nd Saturday), which
// is what most recurring-meetup products mean by "monthly" with a
// weekday picker. When the Nth occurrence doesn't exist in a given
// month (a "5th Friday" club hits a 4-Friday month), it clamps to that
// month's last occurrence of the weekday rather than skipping the
// month entirely — skipping would make the club's own page look broken
// one month in most years.

export type Cadence = "weekly" | "biweekly" | "monthly" | "ad_hoc";

export interface ScheduleConfig {
  cadence: Cadence;
  defaultDay: number | null; // 0=Sunday..6=Saturday
  defaultTime: string | null; // "HH:MM" or "HH:MM:SS" (Postgres time column)
  timezone: string; // IANA zone name
}

// Exported for lib/confirmTiming.ts (and anything else that needs
// timezone-correct date math) to reuse rather than re-deriving its own
// raw-hours arithmetic.
export interface TimeOfDay {
  hour: number;
  minute: number;
}

export interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number;
}

function parseTime(raw: string | null): TimeOfDay | null {
  if (!raw) return null;
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

// Pure calendar-day arithmetic (no timezone involved) — correctly rolls
// over month and year boundaries via Date.UTC's day-overflow handling.
export function addDays(date: CalendarDate, days: number): CalendarDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function weekdayOf(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

// The zone's local calendar date for a given UTC instant.
export function localDateParts(instant: Date, timeZone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

// The zone's UTC offset (local minus UTC, in ms) at a given instant.
function offsetMillisAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - instant.getTime();
}

// Resolves a local calendar date + time-of-day in `timeZone` to the UTC
// instant it represents. Two-pass: the offset can differ between the
// naive guess and the corrected instant right at a DST boundary, so it
// re-checks once. A wall-clock time that doesn't exist (spring-forward
// gap) or is ambiguous (fall-back repeat) isn't rejected — this returns
// some valid instant rather than throwing, which is the right call for
// an evening default_time that will practically never land in a 2am gap.
export function zonedTimeToUtc(date: CalendarDate, time: TimeOfDay, timeZone: string): Date {
  const naiveUtc = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, 0, 0);
  const offset1 = offsetMillisAt(new Date(naiveUtc), timeZone);
  const candidate1 = naiveUtc - offset1;
  const offset2 = offsetMillisAt(new Date(candidate1), timeZone);
  const utcMillis = offset2 === offset1 ? candidate1 : naiveUtc - offset2;
  return new Date(utcMillis);
}

function nextWeeklyOccurrence(
  defaultDay: number,
  time: TimeOfDay,
  timeZone: string,
  from: Date,
): Date {
  const fromDate = localDateParts(from, timeZone);
  const daysUntil = (defaultDay - weekdayOf(fromDate) + 7) % 7;
  const candidateDate = addDays(fromDate, daysUntil);
  const candidate = zonedTimeToUtc(candidateDate, time, timeZone);
  if (candidate.getTime() >= from.getTime()) return candidate;
  return zonedTimeToUtc(addDays(candidateDate, 7), time, timeZone);
}

// Steps forward from the anchor's own weekly-style occurrence in fixed
// periodDays increments — always via local calendar-date addition, so a
// DST shift changes the UTC instant, never the local wall-clock time.
function nextPeriodicOccurrence(
  anchorOccurrence: Date,
  periodDays: number,
  time: TimeOfDay,
  timeZone: string,
  now: Date,
): Date {
  const anchorDate = localDateParts(anchorOccurrence, timeZone);
  const anchorDayNumber = Date.UTC(anchorDate.year, anchorDate.month - 1, anchorDate.day);
  const nowDate = localDateParts(now, timeZone);
  const nowDayNumber = Date.UTC(nowDate.year, nowDate.month - 1, nowDate.day);
  const msPerDay = 86400000;

  let periods = Math.max(0, Math.ceil((nowDayNumber - anchorDayNumber) / (periodDays * msPerDay)));
  for (;;) {
    const candidateDate = addDays(anchorDate, periods * periodDays);
    const candidate = zonedTimeToUtc(candidateDate, time, timeZone);
    if (candidate.getTime() >= now.getTime()) return candidate;
    periods += 1;
  }
}

// The nth occurrence (1-5) of `weekday` in the given month, clamped to
// the month's last occurrence of that weekday if the nth doesn't exist.
function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  n: number,
): CalendarDate {
  const firstWeekday = weekdayOf({ year, month, day: 1 });
  const firstOccurrenceDay = 1 + ((weekday - firstWeekday + 7) % 7);
  const total = daysInMonth(year, month);
  const lastOccurrenceDay = firstOccurrenceDay + Math.floor((total - firstOccurrenceDay) / 7) * 7;
  const day = Math.min(firstOccurrenceDay + (n - 1) * 7, lastOccurrenceDay);
  return { year, month, day };
}

function nextMonth(date: { year: number; month: number }): { year: number; month: number } {
  return date.month === 12 ? { year: date.year + 1, month: 1 } : { year: date.year, month: date.month + 1 };
}

function nextMonthlyOccurrence(
  anchorOccurrence: Date,
  defaultDay: number,
  time: TimeOfDay,
  timeZone: string,
  now: Date,
): Date {
  const anchorDate = localDateParts(anchorOccurrence, timeZone);
  const n = Math.ceil(anchorDate.day / 7);
  let cursor = { year: anchorDate.year, month: anchorDate.month };

  // Bounded (100 years) purely as a backstop against a malformed input
  // looping forever — every real call resolves within one or two steps.
  for (let i = 0; i < 1200; i++) {
    const candidateDate = nthWeekdayOfMonth(cursor.year, cursor.month, defaultDay, n);
    const candidate = zonedTimeToUtc(candidateDate, time, timeZone);
    if (candidate.getTime() >= now.getTime()) return candidate;
    cursor = nextMonth(cursor);
  }
  throw new Error("Could not find a monthly occurrence within 100 years — check the input.");
}

export function getNextOccurrence(config: ScheduleConfig, now: Date, anchor: Date): Date | null {
  if (config.cadence === "ad_hoc") return null;

  if (config.defaultDay === null || config.defaultDay < 0 || config.defaultDay > 6) {
    throw new Error(
      `Cadence "${config.cadence}" needs a default_day (0-6) to schedule from; got ${config.defaultDay}.`,
    );
  }
  const time = parseTime(config.defaultTime);
  if (!time) {
    throw new Error(
      `Cadence "${config.cadence}" needs a default_time to schedule from; got ${config.defaultTime}.`,
    );
  }

  switch (config.cadence) {
    case "weekly":
      return nextWeeklyOccurrence(config.defaultDay, time, config.timezone, now);
    case "biweekly": {
      const anchorOccurrence = nextWeeklyOccurrence(config.defaultDay, time, config.timezone, anchor);
      return nextPeriodicOccurrence(anchorOccurrence, 14, time, config.timezone, now);
    }
    case "monthly": {
      const anchorOccurrence = nextWeeklyOccurrence(config.defaultDay, time, config.timezone, anchor);
      return nextMonthlyOccurrence(anchorOccurrence, config.defaultDay, time, config.timezone, now);
    }
  }
}
