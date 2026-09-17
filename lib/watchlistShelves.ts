// Organizes a member's watchlist into shelves. Pure — no DB calls; the
// caller has already fetched each film plus its club-wide overlap count.
//
// One film, one shelf, by primary genre (watchlist-spec.md §2.1) — never
// duplicated across genres. Shelf order is by size, largest first.
// Shelves with only one film collapse into "Everything else" rather than
// getting their own shelf, so the list doesn't look bigger than it is.
//
// "Everyone wants these" (§2.2) is the one smart shelf built this
// session — on three or more club lists, and only shown once it has at
// least two qualifying films (an empty or single-film smart shelf is
// worse than no smart shelf at all).

const EVERYTHING_ELSE = "Everything else";
const EVERYONE_WANTS_THESE = "Everyone wants these";
const SMART_SHELF_THRESHOLD = 3;

export interface ShelfFilm {
  id: string;
  watchlistItemId: string;
  title: string;
  year: number;
  posterPath: string | null;
  primaryGenre: string | null;
  // Total members in the club with this film on their list, including
  // the viewer — the viewer is trivially one of them, since this shelf
  // is built from the viewer's own list.
  clubOverlapCount: number;
}

export interface Shelf {
  name: string;
  films: ShelfFilm[];
}

export interface BuildShelvesResult {
  smartShelves: Shelf[];
  genreShelves: Shelf[];
}

export function buildShelves(films: ShelfFilm[]): BuildShelvesResult {
  const everyoneWants = films.filter((f) => f.clubOverlapCount >= SMART_SHELF_THRESHOLD);
  const smartShelves: Shelf[] =
    everyoneWants.length >= 2 ? [{ name: EVERYONE_WANTS_THESE, films: everyoneWants }] : [];

  const byGenre = new Map<string, ShelfFilm[]>();
  for (const film of films) {
    const key = film.primaryGenre ?? EVERYTHING_ELSE;
    const bucket = byGenre.get(key);
    if (bucket) {
      bucket.push(film);
    } else {
      byGenre.set(key, [film]);
    }
  }

  const everythingElse: ShelfFilm[] = byGenre.get(EVERYTHING_ELSE) ?? [];
  const sizedShelves: Shelf[] = [];
  for (const [genre, list] of byGenre) {
    if (genre === EVERYTHING_ELSE) continue;
    if (list.length === 1) {
      everythingElse.push(...list);
    } else {
      sizedShelves.push({ name: genre, films: list });
    }
  }
  sizedShelves.sort((a, b) => b.films.length - a.films.length || a.name.localeCompare(b.name));

  const genreShelves =
    everythingElse.length > 0
      ? [...sizedShelves, { name: EVERYTHING_ELSE, films: everythingElse }]
      : sizedShelves;

  return { smartShelves, genreShelves };
}
