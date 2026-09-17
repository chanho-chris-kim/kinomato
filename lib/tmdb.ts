// Stand-in for the real TMDB client. Every exported type mirrors TMDB's
// actual response shapes (verified against developer.themoviedb.org,
// not assumed) — GET /movie/{id}?append_to_response=credits,keywords for
// the per-film shape, GET /search/movie for genre_ids and popularity.
// genre_ids and keyword_ids are convenience arrays our own ingestion
// would derive when enriching a search hit with its detail/credits/
// keywords calls; a real client would compute them the same way, not
// get them free from one endpoint. See the bottom of this file for what
// wiring up the real API actually needs.
//
// Swapping this for the real client is meant to be a one-file change:
// searchMovies() and getMovieById() are the only exports callers use,
// and both are already async. Nothing outside this file should know or
// care that the data is fixture data.

export interface TmdbGenre {
  id: number;
  name: string;
}

export interface TmdbCastMember {
  id: number;
  name: string;
  character: string;
  order: number;
}

export interface TmdbCrewMember {
  id: number;
  name: string;
  job: string;
  department: string;
}

export interface TmdbKeyword {
  id: number;
  name: string;
}

export interface TmdbMovie {
  id: number;
  title: string;
  release_date: string; // YYYY-MM-DD
  poster_path: string | null;
  runtime: number;
  original_language: string;
  popularity: number;
  genres: TmdbGenre[];
  genre_ids: number[];
  credits: {
    cast: TmdbCastMember[];
    crew: TmdbCrewMember[];
  };
  keywords: {
    keywords: TmdbKeyword[];
  };
  keyword_ids: number[];
}

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
  poster_path: string;
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
    poster_path: input.poster_path,
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
// field, so this is a fixture-authoring choice, not a TMDB fact. See
// the note at the bottom of this file.
const FIXTURE_MOVIES: TmdbMovie[] = [
  // Same tmdbId/title/year/runtime/genres as db/seed.ts's hardcoded
  // films — searching finds them, and adding them upserts the existing
  // row (by tmdbId) rather than creating a duplicate.
  movie({
    id: 1091,
    title: "The Thing",
    release_date: "1982-06-25",
    poster_path: "/fixture/the-thing-1982.jpg",
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
    poster_path: "/fixture/thief-1981.jpg",
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
    poster_path: "/fixture/chungking-express-1994.jpg",
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
    poster_path: "/fixture/paddington-2-2017.jpg",
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
    poster_path: "/fixture/hereditary-2018.jpg",
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
    poster_path: "/fixture/the-babadook-2014.jpg",
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
    poster_path: "/fixture/get-out-2017.jpg",
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
    poster_path: "/fixture/heat-1995.jpg",
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
    poster_path: "/fixture/no-country-for-old-men-2007.jpg",
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
    poster_path: "/fixture/in-the-mood-for-love-2000.jpg",
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
    poster_path: "/fixture/the-grand-budapest-hotel-2014.jpg",
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
    poster_path: "/fixture/paddington-2014.jpg",
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
    poster_path: "/fixture/bridesmaids-2011.jpg",
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
    poster_path: "/fixture/superbad-2007.jpg",
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
    poster_path: "/fixture/paprika-2006.jpg",
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
    poster_path: "/fixture/spirited-away-2001.jpg",
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
    poster_path: "/fixture/arrival-2016.jpg",
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
    poster_path: "/fixture/blade-runner-1982.jpg",
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
    poster_path: "/fixture/mad-max-fury-road-2015.jpg",
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
    poster_path: "/fixture/unforgiven-1992.jpg",
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
    poster_path: "/fixture/zodiac-2007.jpg",
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
    poster_path: "/fixture/manchester-by-the-sea-2016.jpg",
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
    poster_path: "/fixture/pans-labyrinth-2006.jpg",
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
    poster_path: "/fixture/whiplash-2014.jpg",
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
    poster_path: "/fixture/free-solo-2018.jpg",
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

// Pure mapping from TMDB's shape to films' insertable shape (db/schema.ts).
// No DB coupling here on purpose — both db/seed.ts (node postgres driver)
// and the app's server action (neon-http, via getDb()) call this with
// their own db instance, sharing this transform instead of duplicating it.
export function tmdbMovieToFilmRow(m: TmdbMovie) {
  return {
    tmdbId: m.id,
    title: m.title,
    year: new Date(m.release_date).getUTCFullYear(),
    runtime: m.runtime,
    posterPath: m.poster_path,
    genres: m.genres.map((g) => g.name),
    genreIds: m.genre_ids,
    directors: m.credits.crew.filter((c) => c.job === "Director").map((c) => c.name),
    cast: m.credits.cast.map((c) => c.name),
    keywords: m.keywords.keywords.map((k) => k.name),
    keywordIds: m.keyword_ids,
    primaryGenre: m.genres[0]?.name ?? null,
    originalLanguage: m.original_language,
    releaseDate: m.release_date,
  };
}

// --- Wiring up the real API next time needs from you: ---
//
// 1. A TMDB API key (v3 auth) or read access token (v4 bearer), server-
//    side only per CLAUDE.md ("Don't put the TMDB key in a NEXT_PUBLIC_
//    variable").
// 2. A real search needs at least two calls per result to match this
//    fixture's shape: GET /search/movie for candidates (title, genre_ids,
//    popularity, poster_path — no runtime, no credits, no keywords), then
//    GET /movie/{id}?append_to_response=credits,keywords per candidate to
//    get runtime/director/cast/keywords for the disambiguation table.
//    That's N+1 calls for N search results — probably wants a concurrency
//    cap and/or only enriching the first page of results, not all matches.
// 3. genre_ids and keyword_ids aren't free from either endpoint as a pair
//    — genre_ids comes from /search/movie, full genre names only from the
//    detail call's `genres` array, keyword ids only from the detail call's
//    `keywords.keywords`. The real client derives genre_ids as
//    genres.map(g => g.id) when merging, same as this fixture does.
// 4. Primary-genre-for-shelf-placement (genres[0]) is a choice this
//    fixture made deliberately per film, not a TMDB fact — TMDB doesn't
//    order genres by relevance. Worth deciding whether "first in the
//    array" is good enough for real data, or whether primary genre needs
//    its own heuristic (e.g. rarest genre, or a fixed priority list).
// 5. Poster URLs need the image CDN base (image.tmdb.org/t/p/{size}) plus
//    a Next.js images.remotePatterns entry in next.config.ts — not
//    configured yet, since this fixture's poster_path values are
//    placeholders that don't resolve to anything real.
// 6. Rate limits and caching: watchlist-spec.md §5 already rules this —
//    cache film metadata indefinitely once fetched, one fetch per film
//    per club-universe. That caching layer doesn't exist yet; right now
//    every add just upserts by tmdbId with whatever came back that call.
