// Pure. No DB calls.
//
// Blind reveal (CLAUDE.md): hot takes stay hidden from everyone until
// every attending member has rated, so the first rater's opinion can't
// anchor everyone else's. "Attending" means an explicit yes-RSVP — a
// rating from anyone else (e.g. a picker who RSVP'd no but rated anyway)
// neither counts toward the reveal nor blocks it.

export function areTakesRevealed(
  attendingMembershipIds: string[],
  ratedMembershipIds: string[],
): boolean {
  const rated = new Set(ratedMembershipIds);
  return attendingMembershipIds.every((id) => rated.has(id));
}
