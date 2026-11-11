// Pure. No DB calls.
//
// Blind reveal (CLAUDE.md): hot takes stay hidden from everyone until
// every attending member has rated, so the first rater's opinion can't
// anchor everyone else's. "Attending" means an explicit yes-RSVP — a
// rating from anyone else (e.g. a picker who RSVP'd no but rated anyway)
// neither counts toward the reveal nor blocks it — from a member still
// active (2026-11-09 ruling): someone who has left (left, removed, or
// deleted their account) is no longer waited on.

export function areTakesRevealed(
  attendingMembershipIds: string[],
  ratedMembershipIds: string[],
): boolean {
  const rated = new Set(ratedMembershipIds);
  return attendingMembershipIds.every((id) => rated.has(id));
}

// Who must rate before a night's ratings reveal: explicit yes-RSVPs from
// memberships still active. The one place this is decided: Tonight,
// History and the tag page all call it. A rejoin is a new membership row
// and the old one stays left, so this set only ever shrinks: a revealed
// night never goes back to hidden.
export function mustRateBeforeReveal(
  rsvps: { membershipId: string; status: "yes" | "no" | null }[],
  activeMembershipIds: Iterable<string>,
): string[] {
  const active = new Set(activeMembershipIds);
  return rsvps.filter((r) => r.status === "yes" && active.has(r.membershipId)).map((r) => r.membershipId);
}
