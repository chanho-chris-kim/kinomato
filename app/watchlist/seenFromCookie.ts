// The global watchlist's Seen from choice (docs/onboarding-spec.md §6.4):
// a first-party cookie, scoped to /watchlist, holding a club id. Read
// through lib/seenFrom.ts, which ignores it unless it's one of the
// viewer's active clubs.
export const SEEN_FROM_COOKIE = "kinomato_seen_from";
