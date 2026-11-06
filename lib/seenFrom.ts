// Which club the global watchlist's badges and smart shelves are "seen
// from" (docs/onboarding-spec.md §6.4, rulings recorded there). Pure.
//
// - No clubs: none. One club: that club, implicitly, no chips.
// - Several clubs: ?seen= presets this visit; else the saved cookie; else
//   the first club by name. Chips show.
// - Only the viewer's own active clubs count: a ?seen= or cookie club id
//   that isn't one of them is ignored, as if unset. Never an error, never
//   another club's data.

export interface SeenFromClub {
  id: string;
  name: string;
}

export function resolveSeenFrom(input: {
  // The viewer's active clubs.
  clubs: SeenFromClub[];
  seenParam: string | undefined;
  cookie: string | undefined;
}): { club: SeenFromClub | null; showChips: boolean } {
  const byName = [...input.clubs].sort((a, b) => a.name.localeCompare(b.name));
  if (byName.length === 0) return { club: null, showChips: false };
  if (byName.length === 1) return { club: byName[0], showChips: false };
  const mine = (id: string | undefined) => (id ? byName.find((c) => c.id === id) : undefined);
  return { club: mine(input.seenParam) ?? mine(input.cookie) ?? byName[0], showChips: true };
}
