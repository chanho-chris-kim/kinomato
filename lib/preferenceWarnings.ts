// "Someone coming would rather not." (docs/onboarding-spec.md §5.10, ruled
// 2026-11-18): a note on an open night's nominee when someone coming has a
// soft preference against it. Pure. Never a name, a count or which
// preference (CLAUDE.md: never surface constraint causality).
//
// - Only explicit yes-RSVPs from active members count; departed members
//   never do (m0). applies_when_absent doesn't bring in anyone not coming.
// - Anonymity threshold: shown only when at least three active members
//   other than the viewer have said yes; with fewer, "someone" could
//   identify a person, so no note for anyone.
// - Only genre and runtime preferences warn. Topic (keyword) preferences
//   can reveal a sensitivity and never do (they still break ties at lock).
// - The viewer's own preference counts like anyone's; it still says
//   "Someone".

import { countSoftPreferenceConflicts, scopeToActiveMembers, type Constraint, type ConstraintFilm, type Rsvp } from "./constraints";

export const PREFERENCE_WARNING = "Someone coming would rather not.";
export const WARNING_THRESHOLD = 3;
const WARNABLE: Constraint["ruleType"][] = ["genre", "runtime"];

export function preferenceWarnings(input: {
  viewerMembershipId: string;
  activeMembershipIds: Iterable<string>;
  rsvps: Rsvp[];
  preferences: Constraint[];
  films: ConstraintFilm[];
}): Set<string> {
  const scoped = scopeToActiveMembers(input.preferences, input.rsvps, input.activeMembershipIds);
  const coming = new Set(scoped.rsvps.filter((r) => r.status === "yes").map((r) => r.membershipId));
  const othersComing = [...coming].filter((id) => id !== input.viewerMembershipId).length;
  if (othersComing < WARNING_THRESHOLD) return new Set();

  const prefs = scoped.constraints.filter(
    (c) => c.kind === "soft" && WARNABLE.includes(c.ruleType) && coming.has(c.membershipId),
  );
  if (prefs.length === 0) return new Set();
  const yesOnly: Rsvp[] = [...coming].map((membershipId) => ({ membershipId, status: "yes" }));
  return new Set(
    countSoftPreferenceConflicts(input.films, prefs, yesOnly)
      .filter((c) => c.conflictCount > 0)
      .map((c) => c.film.id),
  );
}
