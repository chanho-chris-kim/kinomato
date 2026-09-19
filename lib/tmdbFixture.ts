// Fixed ~25-film fixture, same shape as the real TMDB responses
// (verified against developer.themoviedb.org) — GET /movie/{id}?
// append_to_response=credits,keywords for the per-film shape, GET
// /search/movie for genre_ids and popularity.
//
// Two callers, both deliberate:
// - db/seed.ts always imports this module directly, never lib/tmdb.ts.
//   Its hardcoded ids (400001 and up) are fixture-only — they don't
//   exist on the real API, so seeding must never depend on whether a
//   real TMDB_READ_TOKEN happens to be configured.
// - lib/tmdb.ts (the real client) falls back to this module when
//   TMDB_READ_TOKEN is unset, which is how E2E/CI run without a token or
//   real network access: the dev server they hit is the same app code,
//   just missing the token, and degrades to this instead of erroring.
//
// poster_path is null throughout (not a fake "/fixture/..." path) —
// once poster images are real <img>/<Image> tags, a fake path would
// 404 against image.tmdb.org and trip the E2E console-error fixture.
// null uses the app's existing "no poster" placeholder instead, same
// as a real film TMDB has no poster for.

import type { TmdbGenre, TmdbKeyword, TmdbMovie } from "./tmdb";

// Invented but internally consistent — real TMDB keyword ids are
// arbitrary per-keyword database ids with no small fixed list (unlike
// genres), so there's nothing meaningful to "get right" here for a
// fixture. Genre ids, by contrast, are TMDB's real, stable, well-known
// values throughout this file.
const KEYWORD = {
  arctic: { id: 9001, name: "arctic" },
  shapeshifter: { id: 9002, name: "shapeshifter" },
  paranoia: { id: 9003, name: "paranoia" },
  heist: { id: 9004, name: "heist" },
  hitman: { id: 9005, name: "hitman" },
  losAngeles: { id: 9006, name: "los angeles" },
  noCountry: { id: 9007, name: "based on novel or book" },
  hongKong: { id: 9008, name: "hong kong" },
  unrequitedLove: { id: 9009, name: "unrequited love" },
  talkingBear: { id: 9010, name: "talking animal" },
  london: { id: 9011, name: "london" },
  eccentricFamily: { id: 9012, name: "eccentric family hotel" },
  dreamWorld: { id: 9013, name: "dream" },
  japan: { id: 9014, name: "japan" },
  studioGhibli: { id: 9015, name: "spirited away" },
  alienContact: { id: 9016, name: "first contact" },
  linguistics: { id: 9017, name: "linguist" },
  dystopia: { id: 9018, name: "dystopia" },
  replicant: { id: 9019, name: "android" },
  weddingParty: { id: 9020, name: "wedding" },
  rockClimbing: { id: 9021, name: "free solo climbing" },
  revenge: { id: 9022, name: "revenge" },
  oldWest: { id: 9023, name: "old west" },
  homeInvasion: { id: 9024, name: "social thriller" },
  serialKiller: { id: 9025, name: "serial killer" },
  griefAndLoss: { id: 9026, name: "grief" },
  fairyTale: { id: 9027, name: "fairy tale" },
  spanishCivilWar: { id: 9028, name: "spanish civil war" },
  postApocalyptic: { id: 9029, name: "post-apocalyptic" },
  jazzDrumming: { id: 9030, name: "jazz" },
  highSchool: { id: 9031, name: "high school" },
} as const;

function keywords(...entries: (typeof KEYWORD)[keyof typeof KEYWORD][]) {
  return {
    keywords: entries.map((k) => ({ id: k.id, name: k.name })),
    ids: entries.map((k) => k.id),
  };
}

function movie(input: {
  id: number;
  title: string;
  release_date: string;
  runtime: number;
  original_language: string;
  popularity: number;
  genres: TmdbGenre[];
  cast: [name: string, character: string][];
  crew: [name: string, job: string, department: string][];
  keywords: { keywords: TmdbKeyword[]; ids: number[] };
}): TmdbMovie {
  return {
    id: input.id,
    title: input.title,
    release_date: input.release_date,
    poster_path: null,
    runtime: input.runtime,
    original_language: input.original_language,
    popularity: input.popularity,
    genres: input.genres,
    genre_ids: input.genres.map((g) => g.id),
    credits: {
      cast: input.cast.map(([name, character], i) => ({
        id: input.id * 100 + i,
        name,
        character,
        order: i,
      })),
      crew: input.crew.map(([name, job, department], i) => ({
        id: input.id * 100 + 50 + i,
        name,
        job,
        department,
      })),
    },
    keywords: { keywords: input.keywords.keywords },
    keyword_ids: input.keywords.ids,
  };
}

// Real, stable TMDB genre ids — the same ones already used in
// db/seed.ts for The Thing, Thief, Chungking Express, and Paddington 2.
const GENRE = {
  action: { id: 28, name: "Action" },
  adventure: { id: 12, name: "Adventure" },
  animation: { id: 16, name: "Animation" },
  comedy: { id: 35, name: "Comedy" },
  crime: { id: 80, name: "Crime" },
  documentary: { id: 99, name: "Documentary" },
  drama: { id: 18, name: "Drama" },
  family: { id: 10751, name: "Family" },
  fantasy: { id: 14, name: "Fantasy" },
  horror: { id: 27, name: "Horror" },
  music: { id: 10402, name: "Music" },
  mystery: { id: 9648, name: "Mystery" },
  romance: { id: 10749, name: "Romance" },
  sciFi: { id: 878, name: "Science Fiction" },
  thriller: { id: 53, name: "Thriller" },
  war: { id: 10752, name: "War" },
  western: { id: 37, name: "Western" },
};

// The first genre listed is treated as primary for shelf placement
// (lib/watchlistShelves.ts) — TMDB has no official "primary genre"
// field, so this is a fixture-authoring choice, not a TMDB fact.
const FIXTURE_MOVIES: TmdbMovie[] = [
  // Same tmdbId/title/year/runtime/genres as db/seed.ts's hardcoded
  // films — searching finds them, and adding them upserts the existing
  // row (by tmdbId) rather than creating a duplicate.
  movie({
    id: 1091,
    title: "The Thing",
    release_date: "1982-06-25",
    runtime: 109,
    original_language: "en",
    popularity: 45.2,
    genres: [GENRE.horror, GENRE.sciFi],
    cast: [
      ["Kurt Russell", "R.J. MacReady"],
      ["Wilford Brimley", "Dr. Blair"],
      ["Keith David", "Childs"],
    ],
    crew: [["John Carpenter", "Director", "Directing"]],
    keywords: keywords(KEYWORD.arctic, KEYWORD.shapeshifter, KEYWORD.paranoia),
  }),
  movie({
    id: 10651,
    title: "Thief",
    release_date: "1981-03-27",
    runtime: 122,
    original_language: "en",
    popularity: 18.4,
    genres: [GENRE.crime, GENRE.drama],
    cast: [
      ["James Caan", "Frank"],
      ["Tuesday Weld", "Jessie"],
      ["Willie Nelson", "Okla"],
    ],
    crew: [["Michael Mann", "Director", "Directing"]],
    keywords: keywords(KEYWORD.heist, KEYWORD.losAngeles),
  }),
  movie({
    id: 862,
    title: "Chungking Express",
    release_date: "1994-07-14",
    runtime: 102,
    original_language: "cn",
    popularity: 22.7,
    genres: [GENRE.drama, GENRE.romance],
    cast: [
      ["Tony Leung", "Cop 663"],
      ["Faye Wong", "Faye"],
      ["Brigitte Lin", "The Woman in the Blonde Wig"],
    ],
    crew: [["Wong Kar-wai", "Director", "Directing"]],
    keywords: keywords(KEYWORD.hongKong, KEYWORD.unrequitedLove),
  }),
  movie({
    id: 346648,
    title: "Paddington 2",
    release_date: "2017-11-10",
    runtime: 103,
    original_language: "en",
    popularity: 38.1,
    genres: [GENRE.comedy, GENRE.family],
    cast: [
      ["Hugh Bonneville", "Henry Brown"],
      ["Sally Hawkins", "Mary Brown"],
      ["Hugh Grant", "Phoenix Buchanan"],
    ],
    crew: [["Paul King", "Director", "Directing"]],
    keywords: keywords(KEYWORD.talkingBear, KEYWORD.london),
  }),

  // The other ~21 — new to the club, for search/add/remove/overlap.
  movie({
    id: 400001,
    title: "Hereditary",
    release_date: "2018-06-08",
    runtime: 127,
    original_language: "en",
    popularity: 33.6,
    genres: [GENRE.horror, GENRE.mystery],
    cast: [
      ["Toni Collette", "Annie Graham"],
      ["Alex Wolff", "Peter Graham"],
      ["Milly Shapiro", "Charlie Graham"],
    ],
    crew: [["Ari Aster", "Director", "Directing"]],
    keywords: keywords(KEYWORD.griefAndLoss),
  }),
  movie({
    id: 400002,
    title: "The Babadook",
    release_date: "2014-05-22",
    runtime: 94,
    original_language: "en",
    popularity: 20.9,
    genres: [GENRE.horror, GENRE.drama],
    cast: [
      ["Essie Davis", "Amelia"],
      ["Noah Wiseman", "Samuel"],
    ],
    crew: [["Jennifer Kent", "Director", "Directing"]],
    keywords: keywords(KEYWORD.griefAndLoss),
  }),
  movie({
    id: 400003,
    title: "Get Out",
    release_date: "2017-02-24",
    runtime: 104,
    original_language: "en",
    popularity: 41.3,
    genres: [GENRE.horror, GENRE.mystery],
    cast: [
      ["Daniel Kaluuya", "Chris Washington"],
      ["Allison Williams", "Rose Armitage"],
    ],
    crew: [["Jordan Peele", "Director", "Directing"]],
    keywords: keywords(KEYWORD.homeInvasion),
  }),
  movie({
    id: 400004,
    title: "Heat",
    release_date: "1995-12-15",
    runtime: 170,
    original_language: "en",
    popularity: 30.5,
    genres: [GENRE.crime, GENRE.drama, GENRE.thriller],
    cast: [
      ["Al Pacino", "Vincent Hanna"],
      ["Robert De Niro", "Neil McCauley"],
      ["Val Kilmer", "Chris Shiherlis"],
    ],
    crew: [["Michael Mann", "Director", "Directing"]],
    keywords: keywords(KEYWORD.heist, KEYWORD.losAngeles),
  }),
  movie({
    id: 400005,
    title: "No Country for Old Men",
    release_date: "2007-11-21",
    runtime: 122,
    original_language: "en",
    popularity: 27.8,
    genres: [GENRE.crime, GENRE.drama, GENRE.thriller],
    cast: [
      ["Tommy Lee Jones", "Ed Tom Bell"],
      ["Javier Bardem", "Anton Chigurh"],
      ["Josh Brolin", "Llewelyn Moss"],
    ],
    crew: [
      ["Joel Coen", "Director", "Directing"],
      ["Ethan Coen", "Director", "Directing"],
    ],
    keywords: keywords(KEYWORD.noCountry, KEYWORD.revenge),
  }),
  movie({
    id: 400006,
    title: "In the Mood for Love",
    release_date: "2000-09-29",
    runtime: 98,
    original_language: "cn",
    popularity: 19.2,
    genres: [GENRE.drama, GENRE.romance],
    cast: [
      ["Tony Leung", "Chow Mo-wan"],
      ["Maggie Cheung", "Su Li-zhen"],
    ],
    crew: [["Wong Kar-wai", "Director", "Directing"]],
    keywords: keywords(KEYWORD.hongKong, KEYWORD.unrequitedLove),
  }),
  movie({
    id: 400007,
    title: "The Grand Budapest Hotel",
    release_date: "2014-03-28",
    runtime: 99,
    original_language: "en",
    popularity: 34.9,
    genres: [GENRE.comedy, GENRE.drama],
    cast: [
      ["Ralph Fiennes", "M. Gustave"],
      ["Tony Revolori", "Zero Moustafa"],
      ["F. Murray Abraham", "Older Zero"],
    ],
    crew: [["Wes Anderson", "Director", "Directing"]],
    keywords: keywords(KEYWORD.eccentricFamily),
  }),
  movie({
    id: 400008,
    title: "Paddington",
    release_date: "2014-11-28",
    runtime: 95,
    original_language: "en",
    popularity: 29.4,
    genres: [GENRE.comedy, GENRE.family],
    cast: [
      ["Hugh Bonneville", "Henry Brown"],
      ["Ben Whishaw", "Paddington (voice)"],
    ],
    crew: [["Paul King", "Director", "Directing"]],
    keywords: keywords(KEYWORD.talkingBear, KEYWORD.london),
  }),
  movie({
    id: 400009,
    title: "Bridesmaids",
    release_date: "2011-05-13",
    runtime: 125,
    original_language: "en",
    popularity: 24.6,
    genres: [GENRE.comedy, GENRE.romance],
    cast: [
      ["Kristen Wiig", "Annie Walker"],
      ["Maya Rudolph", "Lillian"],
    ],
    crew: [["Paul Feig", "Director", "Directing"]],
    keywords: keywords(KEYWORD.weddingParty),
  }),
  movie({
    id: 400010,
    title: "Superbad",
    release_date: "2007-08-17",
    runtime: 113,
    original_language: "en",
    popularity: 26.1,
    genres: [GENRE.comedy],
    cast: [
      ["Jonah Hill", "Seth"],
      ["Michael Cera", "Evan"],
    ],
    crew: [["Greg Mottola", "Director", "Directing"]],
    keywords: keywords(KEYWORD.highSchool),
  }),
  movie({
    id: 400011,
    title: "Paprika",
    release_date: "2006-11-25",
    runtime: 90,
    original_language: "ja",
    popularity: 17.5,
    genres: [GENRE.animation, GENRE.sciFi],
    cast: [
      ["Megumi Hayashibara", "Dr. Atsuko Chiba / Paprika (voice)"],
      ["Toru Furuya", "Detective Konakawa (voice)"],
    ],
    crew: [["Satoshi Kon", "Director", "Directing"]],
    keywords: keywords(KEYWORD.dreamWorld, KEYWORD.japan),
  }),
  movie({
    id: 400012,
    title: "Spirited Away",
    release_date: "2001-07-20",
    runtime: 125,
    original_language: "ja",
    popularity: 48.7,
    genres: [GENRE.animation, GENRE.family, GENRE.fantasy],
    cast: [
      ["Rumi Hiiragi", "Chihiro (voice)"],
      ["Miyu Irino", "Haku (voice)"],
    ],
    crew: [["Hayao Miyazaki", "Director", "Directing"]],
    keywords: keywords(KEYWORD.studioGhibli, KEYWORD.japan),
  }),
  movie({
    id: 400013,
    title: "Arrival",
    release_date: "2016-11-11",
    runtime: 116,
    original_language: "en",
    popularity: 36.2,
    genres: [GENRE.sciFi, GENRE.drama],
    cast: [
      ["Amy Adams", "Louise Banks"],
      ["Jeremy Renner", "Ian Donnelly"],
    ],
    crew: [["Denis Villeneuve", "Director", "Directing"]],
    keywords: keywords(KEYWORD.alienContact, KEYWORD.linguistics),
  }),
  movie({
    id: 400014,
    title: "Blade Runner",
    release_date: "1982-06-25",
    runtime: 117,
    original_language: "en",
    popularity: 32.8,
    genres: [GENRE.sciFi, GENRE.drama],
    cast: [
      ["Harrison Ford", "Rick Deckard"],
      ["Rutger Hauer", "Roy Batty"],
      ["Sean Young", "Rachael"],
    ],
    crew: [["Ridley Scott", "Director", "Directing"]],
    keywords: keywords(KEYWORD.dystopia, KEYWORD.replicant),
  }),
  movie({
    id: 400015,
    title: "Mad Max: Fury Road",
    release_date: "2015-05-15",
    runtime: 120,
    original_language: "en",
    popularity: 44.0,
    genres: [GENRE.action, GENRE.sciFi, GENRE.adventure],
    cast: [
      ["Tom Hardy", "Max Rockatansky"],
      ["Charlize Theron", "Imperator Furiosa"],
    ],
    crew: [["George Miller", "Director", "Directing"]],
    keywords: keywords(KEYWORD.postApocalyptic),
  }),
  movie({
    id: 400016,
    title: "Unforgiven",
    release_date: "1992-08-07",
    runtime: 130,
    original_language: "en",
    popularity: 15.3,
    genres: [GENRE.western, GENRE.drama],
    cast: [
      ["Clint Eastwood", "William Munny"],
      ["Gene Hackman", "Little Bill Daggett"],
      ["Morgan Freeman", "Ned Logan"],
    ],
    crew: [["Clint Eastwood", "Director", "Directing"]],
    keywords: keywords(KEYWORD.oldWest, KEYWORD.revenge),
  }),
  movie({
    id: 400017,
    title: "Zodiac",
    release_date: "2007-03-02",
    runtime: 157,
    original_language: "en",
    popularity: 21.4,
    genres: [GENRE.thriller, GENRE.crime, GENRE.drama],
    cast: [
      ["Jake Gyllenhaal", "Robert Graysmith"],
      ["Robert Downey Jr.", "Paul Avery"],
      ["Mark Ruffalo", "Dave Toschi"],
    ],
    crew: [["David Fincher", "Director", "Directing"]],
    keywords: keywords(KEYWORD.serialKiller),
  }),
  movie({
    id: 400018,
    title: "Manchester by the Sea",
    release_date: "2016-11-18",
    runtime: 137,
    original_language: "en",
    popularity: 16.7,
    genres: [GENRE.drama],
    cast: [
      ["Casey Affleck", "Lee Chandler"],
      ["Michelle Williams", "Randi"],
    ],
    crew: [["Kenneth Lonergan", "Director", "Directing"]],
    keywords: keywords(KEYWORD.griefAndLoss),
  }),
  movie({
    id: 400019,
    title: "Pan's Labyrinth",
    release_date: "2006-10-11",
    runtime: 118,
    original_language: "es",
    popularity: 28.3,
    genres: [GENRE.fantasy, GENRE.drama, GENRE.war],
    cast: [
      ["Ivana Baquero", "Ofelia"],
      ["Sergi Lopez", "Captain Vidal"],
    ],
    crew: [["Guillermo del Toro", "Director", "Directing"]],
    keywords: keywords(KEYWORD.fairyTale, KEYWORD.spanishCivilWar),
  }),
  movie({
    id: 400020,
    title: "Whiplash",
    release_date: "2014-10-10",
    runtime: 106,
    original_language: "en",
    popularity: 31.1,
    genres: [GENRE.drama, GENRE.music],
    cast: [
      ["Miles Teller", "Andrew Neiman"],
      ["J.K. Simmons", "Terence Fletcher"],
    ],
    crew: [["Damien Chazelle", "Director", "Directing"]],
    keywords: keywords(KEYWORD.jazzDrumming),
  }),
  movie({
    id: 400021,
    title: "Free Solo",
    release_date: "2018-09-28",
    runtime: 100,
    original_language: "en",
    popularity: 12.9,
    genres: [GENRE.documentary],
    cast: [["Alex Honnold", "Himself"]],
    crew: [
      ["Jimmy Chin", "Director", "Directing"],
      ["Elizabeth Chai Vasarhelyi", "Director", "Directing"],
    ],
    keywords: keywords(KEYWORD.rockClimbing),
  }),

  // A real pair from TMDB's own data (not invented) — searching
  // "fleabag" against the live API returns exactly this: a normal
  // result alongside a stub entry with no release_date and no credits.
  // The stub is what 500'd search in production before films.year's
  // NOT NULL insert was guarded against it (CLAUDE.md). Kept here,
  // using TMDB's real ids, so E2E can exercise "one malformed result
  // doesn't take down the rest of the page" without a real API key.
  movie({
    id: 620350,
    title: "National Theatre Live: Fleabag",
    release_date: "2019-09-12",
    runtime: 81,
    original_language: "en",
    popularity: 8.4,
    genres: [GENRE.comedy, GENRE.drama],
    cast: [["Phoebe Waller-Bridge", "Fleabag"]],
    crew: [["Tim Van Someren", "Director", "Directing"]],
    keywords: keywords(),
  }),
  movie({
    id: 1766152,
    title: "Fleabag",
    release_date: "",
    runtime: 0,
    original_language: "en",
    popularity: 0,
    genres: [],
    cast: [],
    crew: [],
    keywords: keywords(),
  }),
];

export async function searchMovies(query: string): Promise<TmdbMovie[]> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  return FIXTURE_MOVIES.filter((m) => m.title.toLowerCase().includes(normalized)).sort(
    (a, b) => b.popularity - a.popularity,
  );
}

export async function getMovieById(id: number): Promise<TmdbMovie | null> {
  return FIXTURE_MOVIES.find((m) => m.id === id) ?? null;
}
