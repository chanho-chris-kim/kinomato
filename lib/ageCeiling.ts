// Club-level age-rating ceiling. Pure — no DB calls. Distinct from
// lib/constraints.ts on purpose: this is a club setting (analysis-v2.md
// §9, "PG-13 and below"), never a per-member constraint — there is no
// 'rating' rule type.
//
// TMDB certification is per-country (release_dates returns one
// certification per country a film released in). This module does not
// know about country at all — the caller is responsible for resolving
// each film's certification for the specific club's country (read from
// clubs.settings alongside the ceiling itself) before calling this
// function. films.certification is currently a single global column per
// film, which cannot correctly serve clubs in different countries; that
// gap is not solved here.
//
// Missing-data policy (CLAUDE.md): a null or unrecognized certification
// fails CLOSED — if we can't confirm a film is at or under the ceiling,
// we don't serve it. This only maps the MPAA ordering used in the US
// (G, PG, PG-13, R, NC-17); other countries' rating systems aren't
// mapped yet, so a non-US certification string will also fail closed
// until they are.

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

export function filterByAgeCeiling(
  input: FilterByAgeCeilingInput,
): FilterByAgeCeilingResult {
  if (input.ceiling === null) {
    return { eligible: input.films, excluded: [] };
  }

  const ceilingRank = rankOf(input.ceiling);
  const eligible: AgeCeilingFilm[] = [];
  const excluded: AgeCeilingFilm[] = [];

  for (const film of input.films) {
    const filmRank =
      film.certification === null ? null : rankOf(film.certification);
    // Unrecognized ceiling, or unknown/unrecognized film certification:
    // fail closed.
    const isEligible =
      ceilingRank !== null && filmRank !== null && filmRank <= ceilingRank;
    (isEligible ? eligible : excluded).push(film);
  }

  return { eligible, excluded };
}
