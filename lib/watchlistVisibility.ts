// Which of a person's watchlist films a club can see (docs/onboarding-spec.md
// §6.2; CLAUDE.md "Which films a club can see goes through one function").
// Pure. app/watchlistRead.ts is the one loader that reads other people's
// watchlist_items, and it passes every result through here: club overlap,
// the "Everyone wants these" shelf, the nominate list and openVoting's
// check all see only what this returns.
//
// Today a club sees every film on its members' lists: §6.2 rules "no
// per-club hiding in v1". Per-club lists or folders (§6.2's later feature,
// §10) plug in here: one new table, its rows loaded by app/watchlistRead.ts
// into ClubVisibilityRules, and this function applying them. No call site
// changes.

export interface WatchlistItemRef {
  userId: string;
  filmId: string;
}

// Empty until per-club folders exist; its shape is theirs to define.
export type ClubVisibilityRules = Record<string, never>;

export const NO_CLUB_RULES: ClubVisibilityRules = {};

export function visibleToClub<T extends WatchlistItemRef>(
  items: T[],
  clubId: string,
  rules: ClubVisibilityRules,
): T[] {
  return items.filter((item) => isVisibleToClub(item, clubId, rules));
}

// v1: every film is visible to every club its owner is in (§6.2).
function isVisibleToClub(
  item: WatchlistItemRef,
  clubId: string,
  rules: ClubVisibilityRules,
): boolean {
  void item;
  void clubId;
  void rules;
  return true;
}
