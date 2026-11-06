// Club overlap (docs/onboarding-spec.md §6.3). Pure.
//
// The number of distinct people among the club's ACTIVE memberships whose
// list contains the film. The unit is a user, not a membership, so:
// leaving a club stops your films counting there; rejoining counts them
// once; nobody counts twice. Items must already be what the club can see
// (lib/watchlistVisibility.ts, applied by app/watchlistRead.ts).
//
// Two numbers use this: shelves count everyone including you (the
// "Everyone wants these" threshold); the search badge counts others
// ("2 others in your club want this"), via excludeUserId.

export function overlapByFilm(
  items: { userId: string; filmId: string }[],
  members: { userId: string; leftAt: Date | null }[],
  options: { excludeUserId?: string } = {},
): Map<string, number> {
  const activeUsers = new Set(members.filter((m) => m.leftAt === null).map((m) => m.userId));
  const holders = new Map<string, Set<string>>();
  for (const { userId, filmId } of items) {
    if (!activeUsers.has(userId) || userId === options.excludeUserId) continue;
    const set = holders.get(filmId) ?? new Set<string>();
    set.add(userId);
    holders.set(filmId, set);
  }
  return new Map([...holders].map(([filmId, users]) => [filmId, users.size]));
}
