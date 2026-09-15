// Club-level age-rating ceiling. Pure — no DB calls. Distinct from
// lib/constraints.ts on purpose: this is a club setting (analysis-v2.md
// §9, "PG-13 and below"), never a per-member constraint — there is no
// 'rating' rule type.
//
// Multi-country certification is deliberately not solved here — see
// CLAUDE.md's Open Questions. This module takes a plain certification
// string per film and has no opinion on how the caller resolved it for
// the club's country. The age-ceiling setting is not exposed in any UI
// yet; with no ceiling configured (null), this is a no-op pass-through.
//
// Missing-data policy (CLAUDE.md) has two axes here:
//   - A null certification is a FACT ABOUT THE FILM (TMDB has no data
//     for it) — fails closed, excluded, same as any other harm-relevant
//     unknown.
//   - An unrecognized ceiling, or a non-null film certification in a
//     rating scheme we haven't mapped, is SYSTEM CONFIGURATION we don't
//     understand — our bug, not a fact about the film. That fails LOUD:
//     it throws, rather than silently emptying the eligible pool the
//     way an unrecognized-value-fails-closed policy would. Only the
//     MPAA ordering (G/PG/PG-13/R/NC-17) is mapped; that's acceptable
//     while the setting is unexposed, since an unmapped scheme is now a
//     visible bug rather than a silent trap.

export interface AgeCeilingFilm {
  id: string;
  certification: string | null;
}

export interface FilterByAgeCeilingInput {
  films: AgeCeilingFilm[];
  // Null means the club hasn't configured a ceiling — no filtering.
  ceiling: string | null;
}

export interface FilterByAgeCeilingResult {
  eligible: AgeCeilingFilm[];
  excluded: AgeCeilingFilm[];
}

const MPAA_ORDER = ["G", "PG", "PG-13", "R", "NC-17"];

function rankOf(certification: string): number | null {
  const index = MPAA_ORDER.indexOf(certification.toUpperCase());
  return index === -1 ? null : index;
}

// Gate settings writes with this — reject an unsupported ceiling before
// it's ever stored, so filterByAgeCeiling's throw below should never
// actually fire against real club data.
export function isValidCeiling(value: string): boolean {
  return rankOf(value) !== null;
}

export function filterByAgeCeiling(
  input: FilterByAgeCeilingInput,
): FilterByAgeCeilingResult {
  if (input.ceiling === null) {
    return { eligible: input.films, excluded: [] };
  }

  const ceilingRank = rankOf(input.ceiling);
  if (ceilingRank === null) {
    throw new Error(
      `Unrecognized age-rating ceiling "${input.ceiling}". This is a ` +
        "configuration bug, not a fact about any film — isValidCeiling() " +
        "should have rejected it at settings-write time.",
    );
  }

  const eligible: AgeCeilingFilm[] = [];
  const excluded: AgeCeilingFilm[] = [];

  for (const film of input.films) {
    if (film.certification === null) {
      // A fact about the film, not a system gap: fails closed.
      excluded.push(film);
      continue;
    }
    const filmRank = rankOf(film.certification);
    if (filmRank === null) {
      // A real, non-null certification we can't place on the MPAA
      // ordering — an unmapped rating scheme. A gap in the system, not
      // a fact about the film: fails loud, not closed.
      throw new Error(
        `Unmappable certification "${film.certification}" on film ` +
          `${film.id}. Only the MPAA ordering (G/PG/PG-13/R/NC-17) is ` +
          "mapped; this rating scheme isn't supported yet.",
      );
    }
    (filmRank <= ceilingRank ? eligible : excluded).push(film);
  }

  return { eligible, excluded };
}
