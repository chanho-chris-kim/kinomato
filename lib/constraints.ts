// Which films are eligible. Pure — no DB calls.
//
// Scoping is asymmetric (CLAUDE.md): a hard limit applies to everyone who
// has NOT explicitly RSVP'd no — no answer counts as attending, since
// silently dropping an unanswered person's hard limit is how they end up
// watching the one thing they can't. A soft preference applies only to
// explicit yes-RSVPs, since it's advisory rather than safety-critical.
// applies_when_absent overrides both, regardless of RSVP status.
//
// No 'rating' rule type — an age-rating ceiling is a club-level filter on
// films.certification, not a member constraint.

export type ConstraintKind = "hard" | "soft";
export type ConstraintRuleType = "genre" | "keyword" | "runtime" | "language";
export type RsvpStatus = "yes" | "no";

export interface ConstraintFilm {
  id: string;
  genres: string[];
  keywords: string[];
  runtime: number | null; // minutes
  originalLanguage: string | null;
}

export interface Constraint {
  id: string;
  membershipId: string;
  kind: ConstraintKind;
  ruleType: ConstraintRuleType;
  value: string;
  appliesWhenAbsent: boolean;
}

export interface Rsvp {
  membershipId: string;
  status: RsvpStatus;
}

export interface ExcludedFilm {
  film: ConstraintFilm;
  constraints: Constraint[];
}

export interface FilterEligibleFilmsInput {
  films: ConstraintFilm[];
  constraints: Constraint[];
  rsvps: Rsvp[];
}

export interface FilterEligibleFilmsResult {
  eligible: ConstraintFilm[];
  excluded: ExcludedFilm[];
}

export interface SoftPreferenceConflict {
  film: ConstraintFilm;
  conflictCount: number;
}

function rsvpStatusFor(
  membershipId: string,
  rsvps: Rsvp[],
): RsvpStatus | null {
  return rsvps.find((r) => r.membershipId === membershipId)?.status ?? null;
}

function constraintApplies(
  constraint: Constraint,
  rsvpStatus: RsvpStatus | null,
): boolean {
  if (constraint.appliesWhenAbsent) return true;
  if (constraint.kind === "hard") return rsvpStatus !== "no";
  return rsvpStatus === "yes";
}

function matchesFilm(constraint: Constraint, film: ConstraintFilm): boolean {
  const value = constraint.value.toLowerCase();
  switch (constraint.ruleType) {
    case "genre":
      return film.genres.some((g) => g.toLowerCase() === value);
    case "keyword":
      return film.keywords.some((k) => k.toLowerCase() === value);
    case "language":
      return film.originalLanguage?.toLowerCase() === value;
    case "runtime":
      // Upper bound in whole minutes, e.g. "nothing over 150 minutes".
      // An unknown runtime never triggers the limit — we can't exclude
      // what we don't know violates it.
      return film.runtime !== null && film.runtime > Number(constraint.value);
  }
}

export function filterEligibleFilms(
  input: FilterEligibleFilmsInput,
): FilterEligibleFilmsResult {
  const eligible: ConstraintFilm[] = [];
  const excluded: ExcludedFilm[] = [];

  for (const film of input.films) {
    const responsible = input.constraints.filter(
      (c) =>
        c.kind === "hard" &&
        matchesFilm(c, film) &&
        constraintApplies(c, rsvpStatusFor(c.membershipId, input.rsvps)),
    );
    if (responsible.length > 0) {
      excluded.push({ film, constraints: responsible });
    } else {
      eligible.push(film);
    }
  }

  return { eligible, excluded };
}

// Hard limits are capped at two per person. Soft preferences don't count
// toward the cap.
export function canAddHardLimit(existingConstraints: Constraint[]): boolean {
  return existingConstraints.filter((c) => c.kind === "hard").length < 2;
}

// Returns a conflict count per film — distinct attending members whose
// soft preference matches. Deliberately does not sort or rank; callers
// decide what to do with the counts (analysis-v2.md §2: club overlap
// descending, then film id, is the documented next tiebreak key after
// this one, but that's the caller's job, not this module's).
export function countSoftPreferenceConflicts(
  films: ConstraintFilm[],
  constraints: Constraint[],
  rsvps: Rsvp[],
): SoftPreferenceConflict[] {
  return films.map((film) => {
    const conflicting = new Set(
      constraints
        .filter(
          (c) =>
            c.kind === "soft" &&
            matchesFilm(c, film) &&
            constraintApplies(c, rsvpStatusFor(c.membershipId, rsvps)),
        )
        .map((c) => c.membershipId),
    );
    return { film, conflictCount: conflicting.size };
  });
}
