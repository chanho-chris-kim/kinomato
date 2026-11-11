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
