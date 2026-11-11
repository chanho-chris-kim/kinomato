// A club's details (name, schedule, timezone, mode), validated in one
// place for /new and the Members tab's edit form (docs/onboarding-spec.md
// §5.8, §5.10). Pure. Messages are fixed strings for the ?error=
// convention; the timezone one quotes the zone typed, which isn't
// personal.

import { localDateParts, parseCalendarDate, weekdayOfDate, type Cadence } from "./schedule";

const CADENCES = ["weekly", "biweekly", "monthly", "ad_hoc"] as const;
const MODES = ["in_person", "remote"] as const;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface ClubDetails {
  name: string;
  cadence: Cadence;
  defaultDay: number;
  defaultTime: string;
  timezone: string;
  mode: (typeof MODES)[number];
}

// Unknown configuration fails loud, never silently accepted (CLAUDE.md).
function isSupportedTimeZone(value: string): boolean {
  try {
    return Intl.supportedValuesOf("timeZone").includes(value);
  } catch {
    return false;
  }
}

const text = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

// The form's raw values. `allowAdHoc`: /new offers "no fixed schedule";
// the edit form doesn't until nights can be scheduled by hand (ruled
// 2026-11-10).
export function readClubDetailsForm(
  fields: { name: unknown; cadence: unknown; defaultDay: unknown; defaultTime: unknown; timezone: unknown; mode: unknown },
  opts: { allowAdHoc: boolean },
): { ok: true; details: ClubDetails } | { ok: false; error: string } {
  const name = text(fields.name).trim();
  const cadence = text(fields.cadence);
  // Number(), as /new always has: a missing day reads as 0, Sunday.
  const defaultDay = Number(fields.defaultDay ?? null);
  const defaultTime = text(fields.defaultTime);
  const timezone = text(fields.timezone).trim();
  const mode = text(fields.mode);

  if (!name) return { ok: false, error: "Club name is required." };
  if (!(CADENCES as readonly string[]).includes(cadence)) return { ok: false, error: "Pick a valid cadence." };
  if (cadence === "ad_hoc" && !opts.allowAdHoc) {
    return { ok: false, error: "No fixed schedule can't be chosen until nights can be scheduled by hand." };
  }
  if (!(MODES as readonly string[]).includes(mode)) return { ok: false, error: "Pick in-person or remote." };
  if (!Number.isInteger(defaultDay) || defaultDay < 0 || defaultDay > 6) {
    return { ok: false, error: "Pick a day of the week." };
  }
  if (!defaultTime) return { ok: false, error: "A default time is required." };
  if (!timezone || !isSupportedTimeZone(timezone)) {
    return { ok: false, error: `"${timezone}" isn't a recognized timezone, e.g. "America/New_York".` };
  }
  return {
    ok: true,
    details: { name, cadence: cadence as Cadence, defaultDay, defaultTime, timezone, mode: mode as ClubDetails["mode"] },
  };
}

// "First night on" is required when the new schedule is biweekly or
// monthly and its counting would otherwise come from somewhere nobody
// chose: the cadence changed into one of them, or the day changed on one.
// Weekly never needs it, and nor does a time or timezone change alone
// (ruled 2026-11-10).
export function firstNightRequired(
  before: { cadence: Cadence; defaultDay: number | null },
  after: { cadence: Cadence; defaultDay: number },
): boolean {
  if (after.cadence !== "biweekly" && after.cadence !== "monthly") return false;
  return before.cadence !== after.cadence || before.defaultDay !== after.defaultDay;
}

// A first night's date: a real date, on the chosen weekday, today or later
// in the club's timezone. Stored as settings.scheduleAnchor (YYYY-MM-DD).
export function checkFirstNight(
  raw: unknown,
  club: { defaultDay: number; timezone: string },
  now: Date,
): { ok: true; date: string } | { ok: false; error: string } {
  const value = text(raw).trim();
  const date = parseCalendarDate(value);
  if (!date) return { ok: false, error: "Pick the date of the first night." };
  if (weekdayOfDate(date) !== club.defaultDay) {
    return { ok: false, error: `The first night has to be on a ${WEEKDAYS[club.defaultDay]}.` };
  }
  const today = localDateParts(now, club.timezone);
  const asNumber = (d: { year: number; month: number; day: number }) => d.year * 10000 + d.month * 100 + d.day;
  if (asNumber(date) < asNumber(today)) return { ok: false, error: "The first night can't be in the past." };
  return { ok: true, date: value };
}
