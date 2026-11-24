// The retired Seen from cookie (Seen from removed 2026-11-24,
// docs/onboarding-spec.md §6.4). Nothing sets or reads it any more; a
// browser that still holds it has it deleted on its next /watchlist visit,
// through ./forget-seen-from. Set with path /watchlist and a year's
// max-age, so both can go after 2027-11-24.
export const RETIRED_SEEN_FROM_COOKIE = "kinomato_seen_from";
