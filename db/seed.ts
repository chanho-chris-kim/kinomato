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
  ratingTags,
  rsvps,
  seasons,
  tags,
  users,
  vetoes,
  votes,
  watchlistItems,
} from "./schema";
import {
  CLUB_2_ID,
  CLUB_3_ID,
  CLUB_4_ID,
  CLUB_5_ID,
  CLUB_6_ID,
  CLUB_ID,
  FILM,
  MEMBERSHIP,
  MEMBERSHIP_2,
  MEMBERSHIP_3,
  MEMBERSHIP_4,
  MEMBERSHIP_5,
  MEMBERSHIP_6,
  NIGHT_3_ID,
  NIGHT_4_ID,
  NIGHT_5_ID,
  NIGHT_6_ID,
  NIGHT_ID,
  NOMINATION,
  USER,
} from "./seed-fixtures";
import { tmdbMovieToFilmRow } from "../lib/tmdb";
// Always the fixture, never lib/tmdb.ts's real client — these ids
// (400001 and up) only exist in the fixture, so seeding must not
// depend on whether a real TMDB_READ_TOKEN happens to be configured.
import { getMovieById } from "../lib/tmdbFixture";

// tmdbIds from lib/tmdb.ts's fixture: Hereditary, The Babadook, Get Out,
// Arrival (watchlist screen), Blade Runner, Zodiac, Whiplash (Nadia's
// watchlist in the second club, for the nomination cap). Inserted via
// the same TMDB-row mapper the app itself uses when a member adds a
// film, so seed data and a real "Add" click produce identically-shaped
// films rows.
const WATCHLIST_DEMO_TMDB_IDS = [
  400001, 400002, 400003, 400013, 400014, 400017, 400020,
] as const;

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
  await db.delete(ratingTags);
  await db.delete(ratings);
  await db.delete(rsvps);
  await db.delete(nominations);
  await db.delete(nights);
  await db.delete(watchlistItems);
  await db.delete(films);
  await db.delete(memberships);
  await db.delete(seasons);
  await db.delete(tags);
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
  const bladeRunnerId = demoFilmIdByTmdbId.get(400014)!;
  const zodiacId = demoFilmIdByTmdbId.get(400017)!;
  const whiplashId = demoFilmIdByTmdbId.get(400020)!;

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

  // A second, separate club for the nomination flow — see
  // seed-fixtures.ts's comment on CLUB_2_ID for why this isn't just a
  // second night bolted onto "Movie Night Crew": that would leave two
  // nights simultaneously "open" once this one opens, and the club
  // page's single-open-night lookup has no defined way to choose
  // between them. Two members is enough: one picks, one votes.
  console.log("Seeding a second club for the nomination flow...");
  await db.insert(clubs).values({
    id: CLUB_2_ID,
    name: "Second Club",
    cadence: "weekly",
    defaultDay: 3,
    defaultTime: "19:30",
    timezone: "America/New_York",
    mode: "remote",
  });

  await db.insert(memberships).values([
    {
      id: MEMBERSHIP_2.nadia,
      clubId: CLUB_2_ID,
      userId: null,
      identityKey: "guest-cookie-nadia-example",
      displayName: "Nadia",
      role: "owner",
      joinedAt: day(1),
    },
    {
      id: MEMBERSHIP_2.omar,
      clubId: CLUB_2_ID,
      userId: null,
      identityKey: "guest-cookie-omar-example",
      displayName: "Omar",
      role: "member",
      joinedAt: day(2),
    },
  ]);

  console.log("Seeding Nadia's watchlist (four films, one over the nomination cap)...");
  // Films are shared across clubs, cached once — reusing the same rows
  // already inserted above rather than re-fetching or duplicating them.
  await db.insert(watchlistItems).values([
    { membershipId: MEMBERSHIP_2.nadia, filmId: hereditaryId },
    { membershipId: MEMBERSHIP_2.nadia, filmId: bladeRunnerId },
    { membershipId: MEMBERSHIP_2.nadia, filmId: zodiacId },
    { membershipId: MEMBERSHIP_2.nadia, filmId: whiplashId },
  ]);

  console.log("Seeding a draft night for Nadia's turn to nominate...");
  // Nadia joined first, so she's who getNextPicker computes as next in
  // this club — no last_picked_at exists yet for anyone here, unlike
  // "Movie Night Crew". A club only has one night in flight in the real
  // flow, but nothing yet creates a night's initial draft row (see
  // CLAUDE.md's Open Questions), so this is seeded directly rather than
  // produced by any app code path.
  await db.insert(nights).values({
    clubId: CLUB_2_ID,
    scheduledAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    pickerMembershipId: MEMBERSHIP_2.nadia,
    state: "draft",
  });

  // A third, separate club for the confirmation/rating flow — see
  // seed-fixtures.ts's comment on CLUB_3_ID. Needs a night that's past
  // its scheduledAt and still non-terminal (locked, as if voting already
  // closed — there's no lock UI yet, so this is seeded directly, same as
  // the watched Thief night above), which the new "one night in flight
  // per club" index means can't share a club with an existing open/draft
  // night.
  console.log("Seeding a third club for the confirmation/rating flow...");
  await db.insert(clubs).values({
    id: CLUB_3_ID,
    name: "Third Club",
    cadence: "weekly",
    defaultDay: 5,
    defaultTime: "20:00",
    timezone: "America/New_York",
    mode: "in_person",
  });

  await db.insert(memberships).values([
    {
      id: MEMBERSHIP_3.leo,
      clubId: CLUB_3_ID,
      userId: null,
      identityKey: "guest-cookie-leo-example",
      displayName: "Leo",
      role: "owner",
      joinedAt: day(1),
    },
    {
      id: MEMBERSHIP_3.mika,
      clubId: CLUB_3_ID,
      userId: null,
      identityKey: "guest-cookie-mika-example",
      displayName: "Mika",
      role: "member",
      joinedAt: day(2),
    },
    {
      id: MEMBERSHIP_3.theo,
      clubId: CLUB_3_ID,
      userId: null,
      identityKey: "guest-cookie-theo-example",
      displayName: "Theo",
      role: "member",
      joinedAt: day(3),
    },
  ]);

  // 2 days ago, not 1 — confirmAt defaults to "morning_after" (9am
  // local the day after scheduledAt), and "1 day ago" is only reliably
  // past that threshold if the seed happens to run after 9am local;
  // "2 days ago" is unambiguously past it at any time of day the E2E
  // suite runs.
  const club3ScheduledAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  await db.insert(nights).values({
    id: NIGHT_3_ID,
    clubId: CLUB_3_ID,
    scheduledAt: club3ScheduledAt,
    pickerMembershipId: MEMBERSHIP_3.leo,
    state: "locked",
    winningFilmId: getOutId,
    lockedAt: club3ScheduledAt,
  });

  // Leo RSVPs no, so he's not "attending" and isn't required to rate for
  // the blind reveal — Mika and Theo are the two attendees.
  await db.insert(rsvps).values([
    { nightId: NIGHT_3_ID, membershipId: MEMBERSHIP_3.leo, status: "no" },
    { nightId: NIGHT_3_ID, membershipId: MEMBERSHIP_3.mika, status: "yes" },
    { nightId: NIGHT_3_ID, membershipId: MEMBERSHIP_3.theo, status: "yes" },
  ]);

  // A fourth, separate club for the "we didn't meet" (cancellation) path
  // — a one-way transition, so it needs its own night rather than
  // reusing club 3's once those tests confirm it watched.
  console.log("Seeding a fourth club for the cancellation flow...");
  await db.insert(clubs).values({
    id: CLUB_4_ID,
    name: "Fourth Club",
    cadence: "weekly",
    defaultDay: 0,
    defaultTime: "19:00",
    timezone: "America/New_York",
    mode: "remote",
  });

  await db.insert(memberships).values([
    {
      id: MEMBERSHIP_4.vik,
      clubId: CLUB_4_ID,
      userId: null,
      identityKey: "guest-cookie-vik-example",
      displayName: "Vik",
      role: "owner",
      joinedAt: day(1),
    },
    {
      id: MEMBERSHIP_4.ana,
      clubId: CLUB_4_ID,
      userId: null,
      identityKey: "guest-cookie-ana-example",
      displayName: "Ana",
      role: "member",
      joinedAt: day(2),
    },
  ]);

  // 2 days ago, not 1 — same reasoning as club3ScheduledAt above.
  const club4ScheduledAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  await db.insert(nights).values({
    id: NIGHT_4_ID,
    clubId: CLUB_4_ID,
    scheduledAt: club4ScheduledAt,
    pickerMembershipId: MEMBERSHIP_4.vik,
    state: "locked",
    winningFilmId: arrivalId,
    lockedAt: club4ScheduledAt,
  });

  // A fifth, separate club for the full nomination-to-lock-to-rating
  // loop through a real "Lock it in" click — see seed-fixtures.ts's
  // comment on CLUB_5_ID. Draft, not locked: this club's night is meant
  // to be driven through open/locked/watched by the E2E test itself,
  // not pre-seeded past those states like clubs 3 and 4.
  console.log("Seeding a fifth club for the full lock loop...");
  await db.insert(clubs).values({
    id: CLUB_5_ID,
    name: "Fifth Club",
    cadence: "weekly",
    defaultDay: 4,
    defaultTime: "20:30",
    timezone: "America/New_York",
    mode: "in_person",
  });

  await db.insert(memberships).values([
    {
      id: MEMBERSHIP_5.zoe,
      clubId: CLUB_5_ID,
      userId: null,
      identityKey: "guest-cookie-zoe-example",
      displayName: "Zoe",
      role: "owner",
      joinedAt: day(1),
    },
    {
      id: MEMBERSHIP_5.yara,
      clubId: CLUB_5_ID,
      userId: null,
      identityKey: "guest-cookie-yara-example",
      displayName: "Yara",
      role: "member",
      joinedAt: day(2),
    },
    {
      id: MEMBERSHIP_5.xavier,
      clubId: CLUB_5_ID,
      userId: null,
      identityKey: "guest-cookie-xavier-example",
      displayName: "Xavier",
      role: "member",
      joinedAt: day(3),
    },
  ]);

  await db.insert(watchlistItems).values([
    { membershipId: MEMBERSHIP_5.zoe, filmId: bladeRunnerId },
    { membershipId: MEMBERSHIP_5.zoe, filmId: zodiacId },
  ]);

  // 2 days ago, not an hour — see seed-fixtures.ts's comment on why
  // this doesn't need to change mid-test the way a real night's clock
  // would. Far enough in the past that confirmAt's default
  // "morning_after" threshold (9am local the day after scheduledAt) has
  // already passed once lock.spec.ts's own real lock click produces a
  // confirmable night, regardless of what time of day the suite runs.
  await db.insert(nights).values({
    id: NIGHT_5_ID,
    clubId: CLUB_5_ID,
    scheduledAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    pickerMembershipId: MEMBERSHIP_5.zoe,
    state: "draft",
  });

  // A sixth, separate club — see seed-fixtures.ts's comment on
  // CLUB_6_ID. settings.confirmAt: "manual_only" plus a scheduledAt in
  // the future is what proves confirmAt actually shifts the
  // confirmation prompt's timing, not just its default value.
  console.log("Seeding a sixth club for confirmAt, slider sync, and tag autocomplete...");
  await db.insert(clubs).values({
    id: CLUB_6_ID,
    name: "Sixth Club",
    cadence: "weekly",
    defaultDay: 5,
    defaultTime: "21:00",
    timezone: "America/New_York",
    mode: "in_person",
    settings: { confirmAt: "manual_only" },
  });

  await db.insert(memberships).values([
    {
      id: MEMBERSHIP_6.nora,
      clubId: CLUB_6_ID,
      userId: null,
      identityKey: "guest-cookie-nora-example",
      displayName: "Nora",
      role: "owner",
      joinedAt: day(1),
    },
    {
      id: MEMBERSHIP_6.iris,
      clubId: CLUB_6_ID,
      userId: null,
      identityKey: "guest-cookie-iris-example",
      displayName: "Iris",
      role: "member",
      joinedAt: day(2),
    },
  ]);

  const club6ScheduledAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  await db.insert(nights).values({
    id: NIGHT_6_ID,
    clubId: CLUB_6_ID,
    scheduledAt: club6ScheduledAt,
    pickerMembershipId: MEMBERSHIP_6.nora,
    state: "locked",
    winningFilmId: hereditaryId,
    lockedAt: club6ScheduledAt,
  });

  await db.insert(rsvps).values([
    { nightId: NIGHT_6_ID, membershipId: MEMBERSHIP_6.nora, status: "yes" },
    { nightId: NIGHT_6_ID, membershipId: MEMBERSHIP_6.iris, status: "yes" },
  ]);

  console.log(`Done. Club id: ${CLUB_ID}, second club id: ${CLUB_2_ID}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
