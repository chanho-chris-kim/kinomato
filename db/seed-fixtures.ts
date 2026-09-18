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
