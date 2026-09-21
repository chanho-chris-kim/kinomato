// Shared identifiers between db/seed.ts and the E2E suite (e2e/), so
// tests reference the exact same rows the seed script creates instead
// of duplicating ids that could drift out of sync.

export const CLUB_ID = "11111111-1111-1111-1111-111111111111";

export const USER = {
  chris: "22222222-2222-2222-2222-222222222221",
  priya: "22222222-2222-2222-2222-222222222222",
  marco: "22222222-2222-2222-2222-222222222223",
  dana: "22222222-2222-2222-2222-222222222224",
  sam: "22222222-2222-2222-2222-222222222225",
};

export const MEMBERSHIP = {
  chris: "33333333-3333-3333-3333-333333333331",
  priya: "33333333-3333-3333-3333-333333333332",
  marco: "33333333-3333-3333-3333-333333333333",
  dana: "33333333-3333-3333-3333-333333333334",
  sam: "33333333-3333-3333-3333-333333333335",
  jo: "33333333-3333-3333-3333-333333333336", // guest, no users row
};

export const DISPLAY_NAME: Record<keyof typeof MEMBERSHIP, string> = {
  chris: "Chris",
  priya: "Priya",
  marco: "Marco",
  dana: "Dana",
  sam: "Sam",
  jo: "Jo",
};

export const FILM = {
  theThing: "44444444-4444-4444-4444-444444444441",
  thief: "44444444-4444-4444-4444-444444444442",
  chungkingExpress: "44444444-4444-4444-4444-444444444443",
  paddington2: "44444444-4444-4444-4444-444444444444",
};

export const FILM_TITLE: Record<keyof typeof FILM, string> = {
  theThing: "The Thing",
  thief: "Thief",
  chungkingExpress: "Chungking Express",
  paddington2: "Paddington 2",
};

export const NIGHT_ID = "55555555-5555-5555-5555-555555555551";

export const NOMINATION = {
  theThing: "66666666-6666-6666-6666-666666666661",
  chungkingExpress: "66666666-6666-6666-6666-666666666662",
  paddington2: "66666666-6666-6666-6666-666666666663",
};

// A second, separate club — exists so the nomination E2E tests have a
// club with exactly one night (draft, then open) to work with. Reusing
// CLUB_ID would mean two simultaneously "open" nights once that draft
// opens (Chris's pre-existing one plus this one), and the club page's
// single `clubNights.find(n => n.state === "open")` has no defined way
// to pick between them — a real gap, not a testing inconvenience to
// route around by asserting less. Isolating in a second club sidesteps
// it without changing that page logic on a guess at the right rule.
export const CLUB_2_ID = "77777777-7777-7777-7777-777777777771";

export const MEMBERSHIP_2 = {
  nadia: "88888888-8888-8888-8888-888888888881", // picker
  omar: "88888888-8888-8888-8888-888888888882", // votes on Nadia's nominees
};

export const DISPLAY_NAME_2: Record<keyof typeof MEMBERSHIP_2, string> = {
  nadia: "Nadia",
  omar: "Omar",
};

// A third, separate club — for the confirmation/rating flow. Needs a
// night that's past its scheduledAt and still non-terminal, which the
// "one night in flight per club" partial unique index means can't be
// bolted onto "Movie Night Crew" (already has Chris's open night) or
// "Second Club" (nomination.spec.ts drives its draft night to open).
// Leo RSVPs no so he's excluded from "attending" — Mika and Theo are the
// two attendees the blind-reveal test needs (hidden until the *second*
// of two ratings lands is a meaningfully different check than "hidden
// until the only rating lands").
export const CLUB_3_ID = "99999999-9999-9999-9999-999999999991";

export const MEMBERSHIP_3 = {
  leo: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1", // picker, confirms the night
  mika: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2", // attending, rates
  theo: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3", // attending, rates
};

export const DISPLAY_NAME_3: Record<keyof typeof MEMBERSHIP_3, string> = {
  leo: "Leo",
  mika: "Mika",
  theo: "Theo",
};

export const NIGHT_3_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";

// A fourth, separate club — for the "we didn't meet" (cancellation)
// path, which is a one-way transition and so needs its own night rather
// than reusing club 3's (already confirmed watched by those tests).
export const CLUB_4_ID = "99999999-9999-9999-9999-999999999992";

export const MEMBERSHIP_4 = {
  vik: "cccccccc-cccc-cccc-cccc-ccccccccccc1", // picker
  ana: "cccccccc-cccc-cccc-cccc-ccccccccccc2",
};

export const DISPLAY_NAME_4: Record<keyof typeof MEMBERSHIP_4, string> = {
  vik: "Vik",
  ana: "Ana",
};

export const NIGHT_4_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2";

// A fifth, separate club — for the full nomination-to-rating loop
// through a real "Lock it in" click, rather than a seeded winner
// standing in for one (clubs 3 and 4 seed winningFilmId directly since
// there's no lock UI when they were written). scheduledAt is seeded in
// the past from the start, not left in the future and advanced mid-test
// — nothing in the vote/lock flow reads scheduledAt, so locking works
// identically either way, and seeding it past-due lets the same night
// qualify for confirmation immediately once locked, with no need to
// fake the passage of time inside the test.
export const CLUB_5_ID = "99999999-9999-9999-9999-999999999993";

export const MEMBERSHIP_5 = {
  zoe: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1", // picker, nominates and votes
  yara: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2",
  xavier: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee3",
};

export const DISPLAY_NAME_5: Record<keyof typeof MEMBERSHIP_5, string> = {
  zoe: "Zoe",
  yara: "Yara",
  xavier: "Xavier",
};

export const NIGHT_5_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3";

// A sixth, separate club — proves confirmAt shifts the confirmation
// prompt's timing (clubs.settings.confirmAt = "manual_only" here) and
// carries both attendees through rating, which is what the RatingSlider
// sync check and the cross-member tag-autocomplete check both need.
// scheduledAt is seeded in the *future*: under the default
// "morning_after", "Did you watch X?" would never appear yet, so seeing
// it appear anyway is what demonstrates manual_only actually changed
// the threshold, not just narrowed it.
export const CLUB_6_ID = "99999999-9999-9999-9999-999999999994";

export const MEMBERSHIP_6 = {
  nora: "ffffffff-ffff-ffff-ffff-fffffffffff1", // picker, rates first, adds a tag
  iris: "ffffffff-ffff-ffff-ffff-fffffffffff2", // rates second, should see Nora's tag as autocomplete
};

export const DISPLAY_NAME_6: Record<keyof typeof MEMBERSHIP_6, string> = {
  nora: "Nora",
  iris: "Iris",
};

export const NIGHT_6_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4";
