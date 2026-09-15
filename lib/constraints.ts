// Which films are eligible. Pure — no DB calls.
//
// Scoping is asymmetric (CLAUDE.md): a hard limit applies to everyone who
// has NOT explicitly RSVP'd no — no answer counts as attending, since
// silently dropping an unanswered person's hard limit is how they end up
// watching the one thing they can't. A soft preference applies only to
// explicit yes-RSVPs, since it's advisory rather than safety-critical.
// applies_when_absent overrides both, regardless of RSVP status.
//
// Genre and keyword constraints match on TMDB ids, never on display
// strings — "Sci-Fi" vs "Science Fiction" must never silently fail a hard
// limit. Language constraints stay on ISO 639-1 codes.
//
// Missing-data policy (CLAUDE.md): unknown data ABOUT A FILM fails closed
// where the gap could cause harm, fails open where it's only inconvenient
// — the test is "would getting this wrong hurt someone, or just annoy
// them?" Empty genre_ids/keyword_ids are treated as a match for a
// genre/keyword hard limit — a body-horror limit protects someone from
// distress, so if we can't confirm a film isn't the excluded thing, we
// don't serve it. A null runtime or original_language is never treated
// as a match — a subtitle limit only protects someone from mild tedium,
// same as runtime being logistics, not safety. Soft preferences never
// fail closed on missing data, or on anything else.
//
// No 'rating' rule type — an age-rating ceiling is a club-level filter
// (lib/ageCeiling.ts) on films.certification, not a member constraint.

export type ConstraintKind = "hard" | "soft";
export type ConstraintRuleType = "genre" | "keyword" | "runtime" | "language";
export type RsvpStatus = "yes" | "no";

export interface ConstraintFilm {
  id: string;
  // Matching fields — TMDB ids, not the display strings below.
  genreIds: number[];
  keywordIds: number[];
  runtime: number | null; // minutes
  originalLanguage: string | null; // ISO 639-1
  // Display-only. Never read by matching logic.
  genres?: string[];
  keywords?: string[];
}

export interface Constraint {
  id: string;
  membershipId: string;
  kind: ConstraintKind;
  // For genre/keyword: the TMDB id, as a string. For language: an ISO
  // 639-1 code. For runtime: whole minutes, upper bound.
  value: string;
  ruleType: ConstraintRuleType;
  // UI-only. Never read by matching logic.
  label?: string | null;
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

// Whether the film's data for this rule type is missing/unknown.
function fieldIsUnknown(
  ruleType: ConstraintRuleType,
  film: ConstraintFilm,
): boolean {
  switch (ruleType) {
    case "genre":
      return film.genreIds.length === 0;
    case "keyword":
      return film.keywordIds.length === 0;
    case "language":
      return film.originalLanguage === null;
    case "runtime":
      return film.runtime === null;
  }
}

// Content fields fail closed on missing data for a hard limit — the harm
// a hard limit prevents (distress, not tedium) is specific to what the
// film contains. Runtime and language fail open: they're logistics and
// mild inconvenience, never safety.
const FAILS_CLOSED_RULE_TYPES: ConstraintRuleType[] = ["genre", "keyword"];

// Missing-data policy: fails closed (treated as a match) for hard limits
// on content fields, fails open for runtime and language, and for soft
// preferences (never exclude on missing data, or anything else).
function unknownDataMatches(constraint: Constraint): boolean {
  if (constraint.kind === "soft") return false;
  return FAILS_CLOSED_RULE_TYPES.includes(constraint.ruleType);
}

function matchesKnownValue(
  constraint: Constraint,
  film: ConstraintFilm,
): boolean {
  switch (constraint.ruleType) {
    case "genre":
      return film.genreIds.includes(Number(constraint.value));
    case "keyword":
      return film.keywordIds.includes(Number(constraint.value));
    case "language":
      return (
        film.originalLanguage?.toLowerCase() ===
        constraint.value.toLowerCase()
      );
    case "runtime":
      // Upper bound in whole minutes, e.g. "nothing over 150 minutes".
      return film.runtime !== null && film.runtime > Number(constraint.value);
  }
}

function matchesFilm(constraint: Constraint, film: ConstraintFilm): boolean {
  if (fieldIsUnknown(constraint.ruleType, film)) {
    return unknownDataMatches(constraint);
  }
  return matchesKnownValue(constraint, film);
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
