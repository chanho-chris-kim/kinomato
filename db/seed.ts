// Dev-only. Wipes every row in dependency order, then inserts one club,
// six members (five accounts + one guest), a handful of films, one open
// night with nominations, a few votes, and a few RSVPs — enough to click
// through the first screen, and the fixture the E2E suite runs against
// (see db/seed-fixtures.ts, e2e/global-setup.ts). Not meant to run
// against anything but a local/dev or dedicated E2E database.
//
// Deliberately not importing db/index.ts's getDb() — that's the
// neon-http driver built for the Worker runtime, request-scoped via
// React's cache(), which doesn't apply here (this is a one-shot Node
// script, not a request handler). A plain node-postgres client is what
// drizzle-kit and this script both use, kept separate from the app's
// runtime driver on purpose — see CLAUDE.md's Stack section.
//
// Run with: npm run db:seed
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import {
  clubs,
  films,
  memberships,
  nights,
  nominations,
  ratings,
  rsvps,
  seasons,
  users,
  vetoes,
  votes,
  watchlistItems,
} from "./schema";
import { CLUB_ID, FILM, MEMBERSHIP, NIGHT_ID, NOMINATION, USER } from "./seed-fixtures";
import { getMovieById, tmdbMovieToFilmRow } from "../lib/tmdb";

// tmdbIds from lib/tmdb.ts's fixture, for the watchlist screen: Hereditary,
// The Babadook, Get Out, Arrival. Inserted via the same TMDB-row mapper the
// app itself uses when a member adds a film, so seed data and a real "Add"
// click produce identically-shaped films rows.
const WATCHLIST_DEMO_TMDB_IDS = [400001, 400002, 400003, 400013] as const;

const databaseUrl = process.env.DATABASE_URL!;
const client = postgres(databaseUrl);
const db = drizzle(client, { schema });

async function main() {
  // Cheap last line of defense: this wipes every row in the target
  // database. Printing the host makes it obvious, before anything is
  // destroyed, if DATABASE_URL is pointed somewhere it shouldn't be —
  // this must never be a production database.
  const host = new URL(databaseUrl).host;
  console.log(`Seeding into: ${host}`);
  console.log("Wiping existing data...");
  await db.delete(votes);
  await db.delete(vetoes);
  await db.delete(ratings);
  await db.delete(rsvps);
  await db.delete(nominations);
  await db.delete(nights);
  await db.delete(watchlistItems);
  await db.delete(films);
  await db.delete(memberships);
  await db.delete(seasons);
  await db.delete(users);
  await db.delete(clubs);

  console.log("Seeding users...");
  await db.insert(users).values([
    { id: USER.chris, email: "chris@example.com" },
    { id: USER.priya, email: "priya@example.com" },
    { id: USER.marco, email: "marco@example.com" },
    { id: USER.dana, email: "dana@example.com" },
    { id: USER.sam, email: "sam@example.com" },
  ]);

  console.log("Seeding club...");
  await db.insert(clubs).values({
    id: CLUB_ID,
    name: "Movie Night Crew",
    cadence: "weekly",
    defaultDay: 6, // Saturday
    defaultTime: "20:00",
    timezone: "America/New_York",
    mode: "in_person",
  });

  console.log("Seeding memberships...");
  // joinedAt staggered so rotation order (never-picked, joined_at ASC)
  // is deterministic: chris, priya, marco, dana, sam, jo.
  const day = (n: number) => new Date(Date.UTC(2026, 0, n));
  await db.insert(memberships).values([
    {
      id: MEMBERSHIP.chris,
      clubId: CLUB_ID,
      userId: USER.chris,
      identityKey: USER.chris,
      displayName: "Chris",
      role: "owner",
      joinedAt: day(1),
    },
    {
      id: MEMBERSHIP.priya,
      clubId: CLUB_ID,
      userId: USER.priya,
      identityKey: USER.priya,
      displayName: "Priya",
      role: "admin",
      joinedAt: day(2),
    },
    {
      id: MEMBERSHIP.marco,
      clubId: CLUB_ID,
      userId: USER.marco,
      identityKey: USER.marco,
      displayName: "Marco",
      role: "member",
      joinedAt: day(3),
    },
    {
      id: MEMBERSHIP.dana,
      clubId: CLUB_ID,
      userId: USER.dana,
      identityKey: USER.dana,
      displayName: "Dana",
      role: "member",
      joinedAt: day(4),
    },
    {
      id: MEMBERSHIP.sam,
      clubId: CLUB_ID,
      userId: USER.sam,
      identityKey: USER.sam,
      displayName: "Sam",
      role: "member",
      joinedAt: day(5),
    },
    {
      id: MEMBERSHIP.jo,
      clubId: CLUB_ID,
      userId: null,
      identityKey: "guest-cookie-jo-example", // stands in for a minted invite-cookie token
      displayName: "Jo",
      role: "guest",
      joinedAt: day(6),
    },
  ]);

  console.log("Seeding films...");
  await db.insert(films).values([
    {
      id: FILM.theThing,
      tmdbId: 1091,
      title: "The Thing",
      year: 1982,
      runtime: 109,
      genres: ["Horror", "Science Fiction"],
      genreIds: [27, 878],
      originalLanguage: "en",
      certification: "R",
    },
    {
      id: FILM.thief,
      tmdbId: 10651,
      title: "Thief",
      year: 1981,
      runtime: 122,
      genres: ["Crime", "Drama"],
      genreIds: [80, 18],
      originalLanguage: "en",
      certification: "R",
    },
    {
      id: FILM.chungkingExpress,
      tmdbId: 862,
      title: "Chungking Express",
      year: 1994,
      runtime: 102,
      genres: ["Drama", "Romance"],
      genreIds: [18, 10749],
      originalLanguage: "cn",
      certification: "PG",
    },
    {
      id: FILM.paddington2,
      tmdbId: 346648,
      title: "Paddington 2",
      year: 2017,
      runtime: 103,
      genres: ["Comedy", "Family"],
      genreIds: [35, 10751],
      originalLanguage: "en",
      certification: "PG",
    },
  ]);

  console.log("Seeding watchlist-demo films from the TMDB fixture...");
  const demoFilmIdByTmdbId = new Map<number, string>();
  for (const tmdbId of WATCHLIST_DEMO_TMDB_IDS) {
    const movie = await getMovieById(tmdbId);
    if (!movie) throw new Error(`lib/tmdb.ts fixture is missing tmdbId ${tmdbId}`);
    const [row] = await db
      .insert(films)
      .values(tmdbMovieToFilmRow(movie))
      .returning({ id: films.id });
    demoFilmIdByTmdbId.set(tmdbId, row.id);
  }
  const babadookId = demoFilmIdByTmdbId.get(400002)!;
  const getOutId = demoFilmIdByTmdbId.get(400003)!;
  const arrivalId = demoFilmIdByTmdbId.get(400013)!;
  const hereditaryId = demoFilmIdByTmdbId.get(400001)!;

  console.log("Seeding one open night, nominated by Chris...");
  const scheduledAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  await db.insert(nights).values({
    id: NIGHT_ID,
    clubId: CLUB_ID,
    scheduledAt,
    pickerMembershipId: MEMBERSHIP.chris,
    state: "open",
  });

  await db.insert(nominations).values([
    {
      id: NOMINATION.theThing,
      nightId: NIGHT_ID,
      filmId: FILM.theThing,
      membershipId: MEMBERSHIP.chris,
    },
    {
      id: NOMINATION.chungkingExpress,
      nightId: NIGHT_ID,
      filmId: FILM.chungkingExpress,
      membershipId: MEMBERSHIP.chris,
    },
    {
      id: NOMINATION.paddington2,
      nightId: NIGHT_ID,
      filmId: FILM.paddington2,
      membershipId: MEMBERSHIP.chris,
    },
  ]);

  console.log("Seeding votes...");
  await db.insert(votes).values([
    { nominationId: NOMINATION.theThing, membershipId: MEMBERSHIP.priya },
    { nominationId: NOMINATION.theThing, membershipId: MEMBERSHIP.marco },
    { nominationId: NOMINATION.chungkingExpress, membershipId: MEMBERSHIP.dana },
  ]);

  console.log("Seeding RSVPs (Sam and Jo left unanswered, on purpose)...");
  await db.insert(rsvps).values([
    { nightId: NIGHT_ID, membershipId: MEMBERSHIP.chris, status: "yes" },
    { nightId: NIGHT_ID, membershipId: MEMBERSHIP.priya, status: "yes" },
    { nightId: NIGHT_ID, membershipId: MEMBERSHIP.marco, status: "no" },
    { nightId: NIGHT_ID, membershipId: MEMBERSHIP.dana, status: "yes" },
  ]);

  console.log("Seeding a watched night (Thief) for the already-watched badge...");
  const watchedAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await db.insert(nights).values({
    clubId: CLUB_ID,
    scheduledAt: watchedAt,
    // Marco, not Chris — doesn't disturb the open night's picker, and
    // Priya/Dana/Sam/Jo staying at last_picked_at = null (never picked)
    // means the rotation's "next picker" is unaffected either way.
    pickerMembershipId: MEMBERSHIP.marco,
    state: "watched",
    winningFilmId: FILM.thief,
    lockedAt: watchedAt,
    confirmedAt: watchedAt,
    confirmedBy: MEMBERSHIP.marco,
  });

  console.log("Seeding watchlist items (Dana's list, plus overlap on Hereditary)...");
  await db.insert(watchlistItems).values([
    // Dana: The Babadook + Get Out (a real 2-film Horror shelf) + Arrival
    // (a singleton, collapses into Everything else) — 94 + 104 + 116 = 314
    // minutes to start.
    { membershipId: MEMBERSHIP.dana, filmId: babadookId },
    { membershipId: MEMBERSHIP.dana, filmId: getOutId },
    { membershipId: MEMBERSHIP.dana, filmId: arrivalId },
    // Hereditary is on two OTHER members' lists, not Dana's — searching
    // it as Dana should show "2 others in your club want this".
    { membershipId: MEMBERSHIP.priya, filmId: hereditaryId },
    { membershipId: MEMBERSHIP.marco, filmId: hereditaryId },
  ]);

  console.log(`Done. Club id: ${CLUB_ID}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
