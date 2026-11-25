// The watchlist's search badges (ruled 2026-11-24, replacing Seen from):
// each names its club, one per club where it applies, clubs in name
// order. Pure. The counts come through app/watchlistRead.ts, so they're
// what each club can see (lib/watchlistVisibility.ts).

export interface ClubBadgeInput {
  name: string;
  // Other active members of this club with the film on their list.
  othersWant: number;
  // This club has watched the film.
  watched: boolean;
}

export interface ClubBadge {
  kind: "overlap" | "watched";
  text: string;
}

export function clubBadges(clubs: ClubBadgeInput[]): ClubBadge[] {
  return [...clubs]
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((c) => [
      ...(c.othersWant > 0
        ? [{ kind: "overlap" as const, text: `${c.othersWant} in ${c.name} want${c.othersWant === 1 ? "s" : ""} this` }]
        : []),
      ...(c.watched ? [{ kind: "watched" as const, text: `${c.name} watched this` }] : []),
    ]);
}
