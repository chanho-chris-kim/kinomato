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

// Accounts for every seeded member beyond club 1's first five (USER).
// There are no guests: every membership is a user's, and the E2E suite
// signs in by session (e2e/session.ts).
export const MEMBER_USER = {
  jo: "dddddddd-0000-0000-0000-000000000001",
  nadia: "dddddddd-0000-0000-0000-000000000002",
  omar: "dddddddd-0000-0000-0000-000000000003",
  leo: "dddddddd-0000-0000-0000-000000000004",
  mika: "dddddddd-0000-0000-0000-000000000005",
  theo: "dddddddd-0000-0000-0000-000000000006",
  vik: "dddddddd-0000-0000-0000-000000000007",
  ana: "dddddddd-0000-0000-0000-000000000008",
  zoe: "dddddddd-0000-0000-0000-000000000009",
  yara: "dddddddd-0000-0000-0000-000000000010",
  xavier: "dddddddd-0000-0000-0000-000000000011",
  nora: "dddddddd-0000-0000-0000-000000000012",
  iris: "dddddddd-0000-0000-0000-000000000013",
  hana: "dddddddd-0000-0000-0000-000000000014",
  ivo: "dddddddd-0000-0000-0000-000000000015",
  wes: "dddddddd-0000-0000-0000-000000000016",
  uma: "dddddddd-0000-0000-0000-000000000017",
  kit: "dddddddd-0000-0000-0000-000000000018",
  lou: "dddddddd-0000-0000-0000-000000000019",
  rae: "dddddddd-0000-0000-0000-000000000020",
  sol: "dddddddd-0000-0000-0000-000000000021",
  tib: "dddddddd-0000-0000-0000-000000000022",
} as const;

export const MEMBERSHIP = {
  chris: "33333333-3333-3333-3333-333333333331",
  priya: "33333333-3333-3333-3333-333333333332",
  marco: "33333333-3333-3333-3333-333333333333",
  dana: "33333333-3333-3333-3333-333333333334",
  sam: "33333333-3333-3333-3333-333333333335",
  jo: "33333333-3333-3333-3333-333333333336",
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

// A seventh, separate club — for the auth flows: signing in again on a
// new device (recovery by email). Wes owns it; Uma is the one who signs
// back in.
export const CLUB_7_ID = "99999999-9999-9999-9999-999999999995";

export const MEMBERSHIP_7 = {
  wes: "aaaaaaaa-1111-1111-1111-000000000071", // owner
  uma: "aaaaaaaa-1111-1111-1111-000000000072", // member
};

export const DISPLAY_NAME_7: Record<keyof typeof MEMBERSHIP_7, string> = {
  wes: "Wes",
  uma: "Uma",
};

// An eighth club — for per-person invites (docs/onboarding-spec.md §7,
// rebuild step 3). Hana owns it, Ivo is a member; both have accounts, and
// names in the new "First R." shape. Two of six seats taken, so the E2E
// spec can create, share, revoke and redeem invites without hitting the
// cap. Chris (club 1) isn't a member: the "signed in as someone else"
// test (Ruling B) uses him.
export const CLUB_8_ID = "99999999-9999-9999-9999-999999999996";

export const MEMBERSHIP_8 = {
  hana: "aaaaaaaa-8888-8888-8888-000000000081", // owner
  ivo: "aaaaaaaa-8888-8888-8888-000000000082", // member, not an admin
};

export const DISPLAY_NAME_8: Record<keyof typeof MEMBERSHIP_8, string> = {
  hana: "Hana K.",
  ivo: "Ivo P.",
};

// A pending invite in club 1, which already has six active members: the
// "full" states (a landing page that won't admit anyone, an owner who
// can't create more). Seeded directly — the app itself refuses to create
// it — and it arises for real when someone joins by the old club-wide
// link while an invite is outstanding.
export const FULL_CLUB_INVITE = {
  id: "aaaaaaaa-8888-8888-8888-000000000091",
  token: "full-club-invite-token-e2e",
  inviteeName: "Zed Q.",
};

// Kit and Lou are in four clubs together, one per Ruling A card state, for
// the signed-in / (docs/onboarding-spec.md §5.7; e2e/home-cards.spec.ts).
// Nothing else touches these clubs, and no spec opens their club pages:
// that would lazily create a draft night in HOME_CLUB.next and change its
// card.
//
// - vote: Lou's open night, Kit hasn't voted → "Voting — you haven't voted"
// - nominate: Kit's draft night → "Your turn to nominate"
// - locked: a locked night tomorrow → "Blade Runner, locked in"
// - next: no nights yet, Lou joined first → "Lou B. picks next"
export const HOME_CLUB = {
  vote: "99999999-9999-9999-9999-999999999997",
  nominate: "99999999-9999-9999-9999-999999999998",
  locked: "99999999-9999-9999-9999-999999999999",
  next: "99999999-9999-9999-9999-99999999999a",
};

export const HOME_CLUB_NAME: Record<keyof typeof HOME_CLUB, string> = {
  vote: "Ninth Club",
  nominate: "Tenth Club",
  locked: "Eleventh Club",
  next: "Twelfth Club",
};

export const MEMBERSHIP_HOME = {
  kit: {
    vote: "aaaaaaaa-9999-9999-9999-000000000091",
    nominate: "aaaaaaaa-9999-9999-9999-000000000092",
    locked: "aaaaaaaa-9999-9999-9999-000000000093",
    next: "aaaaaaaa-9999-9999-9999-000000000094",
  },
  lou: {
    vote: "aaaaaaaa-9999-9999-9999-000000000095",
    nominate: "aaaaaaaa-9999-9999-9999-000000000096",
    locked: "aaaaaaaa-9999-9999-9999-000000000097",
    next: "aaaaaaaa-9999-9999-9999-000000000098",
  },
};

export const DISPLAY_NAME_HOME = {
  kit: "Kit K.",
  lou: "Lou B.",
};

// A club with a finished history, for the History tab (rebuild step 5f;
// e2e/history.spec.ts). Rae, Sol and Tib; four finished nights, oldest
// first:
// - unconfirmed: Tib's pick, Zodiac (votes: Rae, Sol → Zodiac; Tib →
//   Whiplash), never confirmed
// - watched, revealed: Rae's pick, Blade Runner won 2–1 (Sol, Tib → Blade
//   Runner; Rae → Arrival), Tib vetoed Hereditary; Rae and Sol came and
//   both rated, so the ratings show
// - cancelled: Sol's turn, never nominated
// - watched, hidden: Tib's pick, Get Out; all three came, only Sol rated,
//   so the ratings stay hidden
// No spec opens this club's Tonight, which would lazily create a draft.
export const HISTORY_CLUB_ID = "99999999-9999-9999-9999-99999999999b";

export const MEMBERSHIP_HISTORY = {
  rae: "aaaaaaaa-1313-1313-1313-000000000131",
  sol: "aaaaaaaa-1313-1313-1313-000000000132",
  tib: "aaaaaaaa-1313-1313-1313-000000000133",
};

export const DISPLAY_NAME_HISTORY: Record<keyof typeof MEMBERSHIP_HISTORY, string> = {
  rae: "Rae D.",
  sol: "Sol M.",
  tib: "Tib N.",
};

export const HISTORY_TAKE = {
  revealed: "Tears in rain, every time.",
  hidden: "Hidden until everyone rates.",
};
