import type { ConfirmAt } from "@/lib/confirmTiming";

// Choices shared by the club forms: /new and the Members tab's club
// details (docs/onboarding-spec.md §5.8, §5.10).

export const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// A handful of common zones as typing suggestions — not the full ~400
// Intl.supportedValuesOf("timeZone") list, which is too many to be a
// useful <datalist>. The field still accepts (and the action still
// validates) any real IANA zone, typed or picked.
export const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Vancouver",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Kolkata",
  "Australia/Sydney",
];

// How often. Editing offers these three (no fixed schedule isn't offered
// until nights can be scheduled by hand, ruled 2026-11-10); /new adds
// NEW_CLUB_CADENCE_OPTIONS' "No fixed schedule".
export const CADENCE_OPTIONS = [
  ["weekly", "Weekly"],
  ["biweekly", "Every other week"],
  ["monthly", "Monthly"],
] as const;
export const NEW_CLUB_CADENCE_OPTIONS = [...CADENCE_OPTIONS, ["ad_hoc", "No fixed schedule"]] as const;

// When "Did you watch it?" is asked (lib/confirmTiming.ts).
export const CONFIRM_AT_LABELS: Record<ConfirmAt, string> = {
  same_night: "That night",
  morning_after: "The next morning",
  manual_only: "Any time, even before the night",
};

// The night deadlines' settings (ruled 2026-11-21), as hours, in words.
export function hoursLabel(hours: number): string {
  if (hours === 168) return "1 week";
  if (hours >= 24 && hours % 24 === 0) return hours === 24 ? "1 day" : `${hours / 24} days`;
  return hours === 1 ? "1 hour" : `${hours} hours`;
}
