// "Films your club wants that fit everyone" (docs/onboarding-spec.md
// §5.10, ruled 2026-11-17): help for a picker whose list can't fill a
// turn. Pure. The candidates come from app/watchlistRead.ts (other active
// members' lists, through the visibility function, already filtered by
// eligibleForNomination); this decides when to show it and which films.
// Counts only, never names; nothing says why other films are missing.

export const HELP_FILM_LIMIT = 6;

// Fewer nominatable films than nominees per turn, none included.
export function needsHelp(nominatableCount: number, nomineesPerTurn: number): boolean {
  return nominatableCount < nomineesPerTurn;
}

// Not already on the picker's list, wanted by at least one other member,
// most wanted first (then by title), at most six.
export function chooseHelpFilms<F extends { id: string; title: string; othersWant: number }>(
  candidates: F[],
  pickerFilmIds: Set<string>,
): F[] {
  return candidates
    .filter((f) => !pickerFilmIds.has(f.id) && f.othersWant > 0)
    .sort((a, b) => b.othersWant - a.othersWant || a.title.localeCompare(b.title))
    .slice(0, HELP_FILM_LIMIT);
}

// "Wanted in {club}" on the welcome page (u3): films other members want
// that fit everyone, most wanted first, at most six. Unlike the picker's
// help, a film you've just added stays, marked, so the page can show
// "Added ✓". Counts only.
export function chooseWantedFilms<F extends { title: string; othersWant: number }>(candidates: F[]): F[] {
  return candidates
    .filter((f) => f.othersWant > 0)
    .sort((a, b) => b.othersWant - a.othersWant || a.title.localeCompare(b.title))
    .slice(0, HELP_FILM_LIMIT);
}
