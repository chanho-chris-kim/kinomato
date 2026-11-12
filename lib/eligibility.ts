// Which films a hard limit lets through, at the two moments it's applied
// (docs/onboarding-spec.md §5.10, ruled 2026-11-12). Pure, and built on
// lib/constraints.ts's matching and missing-data rules, unchanged. Nobody
// is told why a film isn't there (CLAUDE.md: never surface constraint
// causality), so these return films and ids, never reasons for display.

import { filterEligibleFilms, scopeToActiveMembers, type Constraint, type ConstraintFilm, type Rsvp } from "./constraints";

// At nomination: every active member's hard limits. A draft night has no
// RSVPs yet, and no answer counts as attending, so all of them apply.
// Soft preferences never exclude. Departed members don't count (m0).
export function eligibleForNomination<F extends ConstraintFilm>(
  films: F[],
  constraints: Constraint[],
  activeMembershipIds: Iterable<string>,
): F[] {
  const scoped = scopeToActiveMembers(constraints, [], activeMembershipIds);
  const { eligible } = filterEligibleFilms({ films, constraints: scoped.constraints, rsvps: [] });
  const keep = new Set(eligible.map((f) => f.id));
  return films.filter((f) => keep.has(f.id));
}

// At lock, once: hard limits from active members not explicitly RSVP'd no
// (or set to apply when absent). Nominees now excluded are dropped and
// the pick comes from the rest. A nominee whose film row can't be found
// is dropped too: a film we can't check is never served.
export function filterNomineesAtLock<N extends { id: string; filmId: string }>(input: {
  nominations: N[];
  films: ConstraintFilm[];
  constraints: Constraint[];
  rsvps: Rsvp[];
  activeMembershipIds: Iterable<string>;
}): { kept: N[]; dropped: string[] } {
  const scoped = scopeToActiveMembers(input.constraints, input.rsvps, input.activeMembershipIds);
  const { eligible } = filterEligibleFilms({ films: input.films, ...scoped });
  const ok = new Set(eligible.map((f) => f.id));
  return {
    kept: input.nominations.filter((n) => ok.has(n.filmId)),
    dropped: input.nominations.filter((n) => !ok.has(n.filmId)).map((n) => n.id),
  };
}
