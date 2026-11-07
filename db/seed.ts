// Dev-only. Wipes every row in dependency order, then inserts one club,
// six members (all with accounts), a handful of films, one open
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
import { LEGAL } from "../lib/legal";
import {
  clubs,
  consentEvents,
  constraints,
  dataLicensingConsents,
  emailChanges,
  films,
  invites,
  magicLinks,
  memberships,
  nights,
  nominations,
  ratings,
  ratingTags,
  rsvps,
  seasons,
  sessions,
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
  CLUB_7_ID,
  CLUB_8_ID,
  CLUB_ID,
  DISPLAY_NAME,
  DISPLAY_NAME_2,
  DISPLAY_NAME_3,
  DISPLAY_NAME_4,
  DISPLAY_NAME_5,
  DISPLAY_NAME_6,
  DISPLAY_NAME_7,
  DISPLAY_NAME_8,
  DISPLAY_NAME_HISTORY,
  DISPLAY_NAME_HOME,
  DISPLAY_NAME_RATING,
  DISPLAY_NAME_SEEN,
  FULL_CLUB_INVITE,
  FILM,
  HISTORY_CLUB_ID,
  HISTORY_TAKE,
  HOME_CLUB,
  HOME_CLUB_NAME,
  MEMBERSHIP,
  MEMBERSHIP_2,
  MEMBERSHIP_3,
  MEMBERSHIP_4,
  MEMBERSHIP_5,
  MEMBERSHIP_6,
  MEMBERSHIP_7,
  MEMBERSHIP_8,
  MEMBERSHIP_HISTORY,
  MEMBERSHIP_HOME,
  MEMBERSHIP_RATING,
  MEMBERSHIP_SEEN,
  MEMBER_USER,
  NIGHT_3_ID,
  NIGHT_4_ID,
  NIGHT_5_ID,
  NIGHT_6_ID,
  NIGHT_ID,
  NOMINATION,
  RATING_CLUB_ID,
  RATING_NIGHT_ID,
  SEEN_CLUB,
  SEEN_CLUB_NAME,
  USER,
  CONSENT_CLUB_ID,
  CONSENT_INVITE,
  CONSENT_NIGHT_ID,
  DISPLAY_NAME_CONSENT,
  MEMBERSHIP_CONSENT,
  UNCONSENTED_USERS,
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
  await db.delete(magicLinks);
  await db.delete(invites);
  await db.delete(sessions);
  await db.delete(emailChanges);
  await db.delete(consentEvents);
  await db.delete(dataLicensingConsents);
  await db.delete(constraints);
  await db.delete(memberships);
  await db.delete(seasons);
  await db.delete(tags);
  await db.delete(users);
  await db.delete(clubs);

  console.log("Seeding users...");
  // Every member is an account, named on the account (names live on
  // users — docs/onboarding-spec.md §8.2); memberships carry no name.
  const NAME: Record<string, string> = {
    ...DISPLAY_NAME,
    ...DISPLAY_NAME_2,
    ...DISPLAY_NAME_3,
    ...DISPLAY_NAME_4,
    ...DISPLAY_NAME_5,
    ...DISPLAY_NAME_6,
    ...DISPLAY_NAME_7,
    ...DISPLAY_NAME_8,
    ...DISPLAY_NAME_HOME,
    ...DISPLAY_NAME_HISTORY,
    ...DISPLAY_NAME_RATING,
    ...DISPLAY_NAME_SEEN,
    ...DISPLAY_NAME_CONSENT,
  };
  // Everyone has accepted the current Terms and Privacy and is 18 or
  // older, except the consent spec's two (seed-fixtures.ts
  // UNCONSENTED_USERS), so no other spec is sent to /consent.
  const seededUsers = [
    { id: USER.chris, email: "chris@example.com", displayName: NAME.chris },
    { id: USER.priya, email: "priya@example.com", displayName: NAME.priya },
    { id: USER.marco, email: "marco@example.com", displayName: NAME.marco },
    { id: USER.dana, email: "dana@example.com", displayName: NAME.dana },
    { id: USER.sam, email: "sam@example.com", displayName: NAME.sam },
    // Everyone else (seed-fixtures.ts MEMBER_USER).
    ...Object.entries(MEMBER_USER).map(([name, id]) => ({
      id,
      email: `${name}@example.com`,
      displayName: NAME[name],
    })),
  ];
  const consented = seededUsers.filter((u) => !UNCONSENTED_USERS.includes(u.id));
  const attested = new Date(Date.UTC(2026, 0, 1));
  await db.insert(users).values(
    seededUsers.map((u) =>
      UNCONSENTED_USERS.includes(u.id) ? u : { ...u, ageBracket: "18_plus" as const, ageAttestedAt: attested },
    ),
  );
  await db.insert(consentEvents).values(
    consented.flatMap((u) =>
      (["terms", "privacy"] as const).map((document) => ({
        userId: u.id,
        document,
        version: LEGAL[document].version,
        acceptedAt: attested,
        method: "signup" as const,
      })),
    ),
  );

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
      role: "owner",
      joinedAt: day(1),
    },
    {
      id: MEMBERSHIP.priya,
      clubId: CLUB_ID,
      userId: USER.priya,
      role: "admin",
      joinedAt: day(2),
    },
    {
      id: MEMBERSHIP.marco,
      clubId: CLUB_ID,
      userId: USER.marco,
      role: "member",
      joinedAt: day(3),
    },
    {
      id: MEMBERSHIP.dana,
      clubId: CLUB_ID,
      userId: USER.dana,
      role: "member",
      joinedAt: day(4),
    },
    {
      id: MEMBERSHIP.sam,
      clubId: CLUB_ID,
      userId: USER.sam,
      role: "member",
      joinedAt: day(5),
    },
    {
      id: MEMBERSHIP.jo,
      clubId: CLUB_ID,
      userId: MEMBER_USER.jo,
      role: "member",
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
    { userId: USER.dana, filmId: babadookId },
    { userId: USER.dana, filmId: getOutId },
    { userId: USER.dana, filmId: arrivalId },
    // Hereditary is on two OTHER members' lists, not Dana's — searching
    // it as Dana should show "2 others in your club want this".
    { userId: USER.priya, filmId: hereditaryId },
    { userId: USER.marco, filmId: hereditaryId },
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
      userId: MEMBER_USER.nadia,
      role: "owner",
      joinedAt: day(1),
    },
    {
      id: MEMBERSHIP_2.omar,
      clubId: CLUB_2_ID,
      userId: MEMBER_USER.omar,
      role: "member",
      joinedAt: day(2),
    },
  ]);

  console.log("Seeding Nadia's watchlist (four films, one over the nomination cap)...");
  // Films are shared across clubs, cached once — reusing the same rows
  // already inserted above rather than re-fetching or duplicating them.
  await db.insert(watchlistItems).values([
    { userId: MEMBER_USER.nadia, filmId: hereditaryId },
    { userId: MEMBER_USER.nadia, filmId: bladeRunnerId },
    { userId: MEMBER_USER.nadia, filmId: zodiacId },
    { userId: MEMBER_USER.nadia, filmId: whiplashId },
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
      userId: MEMBER_USER.leo,
      role: "owner",
      joinedAt: day(1),
    },
    {
      id: MEMBERSHIP_3.mika,
      clubId: CLUB_3_ID,
      userId: MEMBER_USER.mika,
      role: "member",
      joinedAt: day(2),
    },
    {
      id: MEMBERSHIP_3.theo,
      clubId: CLUB_3_ID,
      userId: MEMBER_USER.theo,
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
      userId: MEMBER_USER.vik,
      role: "owner",
      joinedAt: day(1),
    },
    {
      id: MEMBERSHIP_4.ana,
      clubId: CLUB_4_ID,
      userId: MEMBER_USER.ana,
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
      userId: MEMBER_USER.zoe,
      role: "owner",
      joinedAt: day(1),
    },
    {
      id: MEMBERSHIP_5.yara,
      clubId: CLUB_5_ID,
      userId: MEMBER_USER.yara,
      role: "member",
      joinedAt: day(2),
    },
    {
      id: MEMBERSHIP_5.xavier,
      clubId: CLUB_5_ID,
      userId: MEMBER_USER.xavier,
      role: "member",
      joinedAt: day(3),
    },
  ]);

  await db.insert(watchlistItems).values([
    { userId: MEMBER_USER.zoe, filmId: bladeRunnerId },
    { userId: MEMBER_USER.zoe, filmId: zodiacId },
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
      userId: MEMBER_USER.nora,
      role: "owner",
      joinedAt: day(1),
    },
    {
      id: MEMBERSHIP_6.iris,
      clubId: CLUB_6_ID,
      userId: MEMBER_USER.iris,
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

  // A seventh, separate club — see seed-fixtures.ts's comment on
  // CLUB_7_ID. Both members have accounts.
  console.log("Seeding a seventh club for the auth flows...");
  await db.insert(clubs).values({
    id: CLUB_7_ID,
    name: "Seventh Club",
    cadence: "weekly",
    defaultDay: 2,
    defaultTime: "19:00",
    timezone: "America/New_York",
    mode: "remote",
  });

  await db.insert(memberships).values([
    {
      id: MEMBERSHIP_7.wes,
      clubId: CLUB_7_ID,
      userId: MEMBER_USER.wes,
      role: "owner",
      joinedAt: day(1),
    },
    {
      id: MEMBERSHIP_7.uma,
      clubId: CLUB_7_ID,
      userId: MEMBER_USER.uma,
      role: "member",
      joinedAt: day(2),
    },
  ]);

  // An eighth club — see seed-fixtures.ts's comment on CLUB_8_ID.
  console.log("Seeding an eighth club for per-person invites...");
  await db.insert(clubs).values({
    id: CLUB_8_ID,
    name: "Eighth Club",
    cadence: "weekly",
    defaultDay: 5,
    defaultTime: "20:00",
    timezone: "America/New_York",
    mode: "in_person",
  });
  await db.insert(memberships).values([
    {
      id: MEMBERSHIP_8.hana,
      clubId: CLUB_8_ID,
      userId: MEMBER_USER.hana,
      role: "owner",
      joinedAt: day(1),
    },
    {
      id: MEMBERSHIP_8.ivo,
      clubId: CLUB_8_ID,
      userId: MEMBER_USER.ivo,
      role: "member",
      joinedAt: day(2),
    },
  ]);

  // Club 1 is already at six active members; see FULL_CLUB_INVITE.
  await db.insert(invites).values({
    id: FULL_CLUB_INVITE.id,
    clubId: CLUB_ID,
    token: FULL_CLUB_INVITE.token,
    inviteeName: FULL_CLUB_INVITE.inviteeName,
    invitedByMembershipId: MEMBERSHIP.chris,
  });

  // Kit and Lou's four clubs, one per card state on the signed-in / (see
  // seed-fixtures.ts's HOME_CLUB).
  console.log("Seeding Kit and Lou's clubs for the club cards...");
  const HOUR = 60 * 60 * 1000;
  // Twelfth Club's standing day is three days ahead, so its computed next
  // night always sorts after Eleventh Club's locked night tomorrow.
  const threeDaysAhead = (new Date().getUTCDay() + 3) % 7;
  await db.insert(clubs).values(
    (Object.keys(HOME_CLUB) as (keyof typeof HOME_CLUB)[]).map((key) => ({
      id: HOME_CLUB[key],
      name: HOME_CLUB_NAME[key],
      cadence: "weekly" as const,
      defaultDay: key === "next" ? threeDaysAhead : 6,
      defaultTime: "20:00",
      timezone: "America/New_York",
      mode: "in_person" as const,
    })),
  );
  await db.insert(memberships).values(
    (Object.keys(HOME_CLUB) as (keyof typeof HOME_CLUB)[]).flatMap((key) => [
      // Lou joined first everywhere, so with no picks yet Lou is next.
      {
        id: MEMBERSHIP_HOME.lou[key],
        clubId: HOME_CLUB[key],
        userId: MEMBER_USER.lou,
        role: "owner" as const,
        joinedAt: day(1),
      },
      {
        id: MEMBERSHIP_HOME.kit[key],
        clubId: HOME_CLUB[key],
        userId: MEMBER_USER.kit,
        role: "member" as const,
        joinedAt: day(2),
      },
    ]),
  );
  const [voteNight] = await db
    .insert(nights)
    .values({
      clubId: HOME_CLUB.vote,
      scheduledAt: new Date(Date.now() + 72 * HOUR),
      pickerMembershipId: MEMBERSHIP_HOME.lou.vote,
      state: "open",
    })
    .returning({ id: nights.id });
  await db.insert(nominations).values([
    { nightId: voteNight.id, filmId: hereditaryId, membershipId: MEMBERSHIP_HOME.lou.vote },
    { nightId: voteNight.id, filmId: zodiacId, membershipId: MEMBERSHIP_HOME.lou.vote },
  ]);
  await db.insert(nights).values([
    {
      clubId: HOME_CLUB.nominate,
      scheduledAt: new Date(Date.now() + 144 * HOUR),
      pickerMembershipId: MEMBERSHIP_HOME.kit.nominate,
      state: "draft",
    },
    {
      clubId: HOME_CLUB.locked,
      scheduledAt: new Date(Date.now() + 24 * HOUR),
      pickerMembershipId: MEMBERSHIP_HOME.lou.locked,
      state: "locked",
      winningFilmId: bladeRunnerId,
      lockedAt: new Date(),
    },
  ]);

  // A club with a finished history (seed-fixtures.ts HISTORY_CLUB_ID).
  console.log("Seeding a club with history...");
  const H = MEMBERSHIP_HISTORY;
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  await db.insert(clubs).values({
    id: HISTORY_CLUB_ID,
    name: "History Club",
    cadence: "weekly",
    defaultDay: 6,
    defaultTime: "20:00",
    timezone: "America/New_York",
    mode: "in_person",
  });
  await db.insert(memberships).values([
    { id: H.rae, clubId: HISTORY_CLUB_ID, userId: MEMBER_USER.rae, role: "owner", joinedAt: day(1) },
    { id: H.sol, clubId: HISTORY_CLUB_ID, userId: MEMBER_USER.sol, role: "member", joinedAt: day(2) },
    { id: H.tib, clubId: HISTORY_CLUB_ID, userId: MEMBER_USER.tib, role: "member", joinedAt: day(3) },
  ]);
  const [hUnconfirmed, hRevealed, , hHidden] = await db
    .insert(nights)
    .values([
      { clubId: HISTORY_CLUB_ID, scheduledAt: daysAgo(28), pickerMembershipId: H.tib, state: "unconfirmed", winningFilmId: zodiacId, lockedAt: daysAgo(29) },
      { clubId: HISTORY_CLUB_ID, scheduledAt: daysAgo(21), pickerMembershipId: H.rae, state: "watched", winningFilmId: bladeRunnerId, lockedAt: daysAgo(22), confirmedAt: daysAgo(20), confirmedBy: H.rae },
      { clubId: HISTORY_CLUB_ID, scheduledAt: daysAgo(14), pickerMembershipId: H.sol, state: "cancelled", confirmedAt: daysAgo(13), confirmedBy: H.sol },
      { clubId: HISTORY_CLUB_ID, scheduledAt: daysAgo(7), pickerMembershipId: H.tib, state: "watched", winningFilmId: getOutId, lockedAt: daysAgo(8), confirmedAt: daysAgo(6), confirmedBy: H.tib },
    ])
    .returning({ id: nights.id });
  const [uZodiac, uWhiplash, rBlade, rArrival, rHereditary, hGetOut] = await db
    .insert(nominations)
    .values([
      { nightId: hUnconfirmed.id, filmId: zodiacId, membershipId: H.tib },
      { nightId: hUnconfirmed.id, filmId: whiplashId, membershipId: H.tib },
      { nightId: hRevealed.id, filmId: bladeRunnerId, membershipId: H.rae },
      { nightId: hRevealed.id, filmId: arrivalId, membershipId: H.rae },
      { nightId: hRevealed.id, filmId: hereditaryId, membershipId: H.rae },
      { nightId: hHidden.id, filmId: getOutId, membershipId: H.tib },
      { nightId: hHidden.id, filmId: babadookId, membershipId: H.tib },
    ])
    .returning({ id: nominations.id });
  await db.insert(votes).values([
    { nominationId: uZodiac.id, membershipId: H.rae },
    { nominationId: uZodiac.id, membershipId: H.sol },
    { nominationId: uWhiplash.id, membershipId: H.tib },
    { nominationId: rBlade.id, membershipId: H.sol },
    { nominationId: rBlade.id, membershipId: H.tib },
    { nominationId: rArrival.id, membershipId: H.rae },
    { nominationId: hGetOut.id, membershipId: H.rae },
    { nominationId: hGetOut.id, membershipId: H.sol },
  ]);
  const [hSeason] = await db
    .insert(seasons)
    .values({ clubId: HISTORY_CLUB_ID, startedAt: daysAgo(60) })
    .returning({ id: seasons.id });
  await db.insert(vetoes).values({
    nightId: hRevealed.id,
    nominationId: rHereditary.id,
    membershipId: H.tib,
    seasonId: hSeason.id,
  });
  await db.insert(rsvps).values([
    { nightId: hRevealed.id, membershipId: H.rae, status: "yes" },
    { nightId: hRevealed.id, membershipId: H.sol, status: "yes" },
    { nightId: hRevealed.id, membershipId: H.tib, status: "no" },
    { nightId: hHidden.id, membershipId: H.rae, status: "yes" },
    { nightId: hHidden.id, membershipId: H.sol, status: "yes" },
    { nightId: hHidden.id, membershipId: H.tib, status: "yes" },
  ]);
  const [raeRating] = await db
    .insert(ratings)
    .values([
      { nightId: hRevealed.id, membershipId: H.rae, scoreQuality: "8.5", scoreFun: "9.0", hotTake: HISTORY_TAKE.revealed },
      { nightId: hRevealed.id, membershipId: H.sol, scoreQuality: "7.0", scoreFun: "8.0" },
      { nightId: hHidden.id, membershipId: H.sol, scoreQuality: "6.0", scoreFun: "7.5", hotTake: HISTORY_TAKE.hidden },
    ])
    .returning({ id: ratings.id });
  const [rainy] = await db
    .insert(tags)
    .values({ clubId: HISTORY_CLUB_ID, name: "rainy", displayName: "Rainy" })
    .returning({ id: tags.id });
  await db.insert(ratingTags).values({ ratingId: raeRating.id, tagId: rainy.id });

  // Rating and tag upserts (seed-fixtures.ts RATING_CLUB_ID).
  console.log("Seeding a club for rating and tag upserts...");
  const RT = MEMBERSHIP_RATING;
  await db.insert(clubs).values({
    id: RATING_CLUB_ID,
    name: "Rating Club",
    cadence: "weekly",
    defaultDay: 6,
    defaultTime: "20:00",
    timezone: "America/New_York",
    mode: "in_person",
  });
  await db.insert(memberships).values([
    { id: RT.pia, clubId: RATING_CLUB_ID, userId: MEMBER_USER.pia, role: "owner", joinedAt: day(1) },
    { id: RT.quin, clubId: RATING_CLUB_ID, userId: MEMBER_USER.quin, role: "member", joinedAt: day(2) },
    { id: RT.rex, clubId: RATING_CLUB_ID, userId: MEMBER_USER.rex, role: "member", joinedAt: day(3) },
  ]);
  await db.insert(nights).values({
    id: RATING_NIGHT_ID,
    clubId: RATING_CLUB_ID,
    scheduledAt: daysAgo(3),
    pickerMembershipId: RT.pia,
    state: "watched",
    winningFilmId: arrivalId,
    lockedAt: daysAgo(4),
    confirmedAt: daysAgo(2),
    confirmedBy: RT.pia,
  });
  await db.insert(rsvps).values([
    { nightId: RATING_NIGHT_ID, membershipId: RT.pia, status: "yes" },
    { nightId: RATING_NIGHT_ID, membershipId: RT.quin, status: "yes" },
    { nightId: RATING_NIGHT_ID, membershipId: RT.rex, status: "yes" },
  ]);

  // Seen from on the global watchlist (seed-fixtures.ts SEEN_CLUB).
  console.log("Seeding Apple and Birch clubs for Seen from...");
  const SN = MEMBERSHIP_SEEN;
  await db.insert(clubs).values(
    (Object.keys(SEEN_CLUB) as (keyof typeof SEEN_CLUB)[]).map((key) => ({
      id: SEEN_CLUB[key],
      name: SEEN_CLUB_NAME[key],
      cadence: "weekly" as const,
      defaultDay: 6,
      defaultTime: "20:00",
      timezone: "America/New_York",
      mode: "in_person" as const,
    })),
  );
  await db.insert(memberships).values([
    { id: SN.skyApple, clubId: SEEN_CLUB.apple, userId: MEMBER_USER.sky, role: "owner", joinedAt: day(1) },
    { id: SN.ava, clubId: SEEN_CLUB.apple, userId: MEMBER_USER.ava, role: "member", joinedAt: day(2) },
    { id: SN.cal, clubId: SEEN_CLUB.apple, userId: MEMBER_USER.cal, role: "member", joinedAt: day(3) },
    { id: SN.skyBirch, clubId: SEEN_CLUB.birch, userId: MEMBER_USER.sky, role: "owner", joinedAt: day(1) },
    { id: SN.ben, clubId: SEEN_CLUB.birch, userId: MEMBER_USER.ben, role: "member", joinedAt: day(2) },
  ]);
  await db.insert(watchlistItems).values([
    { userId: MEMBER_USER.sky, filmId: hereditaryId },
    { userId: MEMBER_USER.sky, filmId: zodiacId },
    { userId: MEMBER_USER.ava, filmId: hereditaryId },
    { userId: MEMBER_USER.ava, filmId: zodiacId },
    { userId: MEMBER_USER.cal, filmId: hereditaryId },
    { userId: MEMBER_USER.cal, filmId: zodiacId },
    { userId: MEMBER_USER.ben, filmId: whiplashId },
  ]);
  await db.insert(nights).values({
    clubId: SEEN_CLUB.apple,
    scheduledAt: daysAgo(10),
    pickerMembershipId: SN.ava,
    state: "watched",
    winningFilmId: FILM.thief,
    lockedAt: daysAgo(11),
    confirmedAt: daysAgo(9),
    confirmedBy: SN.ava,
  });

  // Consent (seed-fixtures.ts CONSENT_CLUB_ID): Fay has a row of every
  // kind the §11.4 anonymisation touches or keeps.
  console.log("Seeding Consent Club...");
  const CS = MEMBERSHIP_CONSENT;
  await db.insert(clubs).values({
    id: CONSENT_CLUB_ID,
    name: "Consent Club",
    cadence: "weekly",
    defaultDay: 6,
    defaultTime: "20:00",
    timezone: "America/New_York",
    mode: "in_person",
  });
  await db.insert(memberships).values([
    { id: CS.fay, clubId: CONSENT_CLUB_ID, userId: MEMBER_USER.fay, role: "owner", joinedAt: day(1) },
    { id: CS.gus, clubId: CONSENT_CLUB_ID, userId: MEMBER_USER.gus, role: "member", joinedAt: day(2) },
  ]);
  await db.insert(watchlistItems).values({ userId: MEMBER_USER.fay, filmId: zodiacId });
  await db.insert(constraints).values({
    membershipId: CS.fay,
    kind: "hard",
    ruleType: "genre",
    value: "27",
    label: "Horror",
  });
  await db.insert(nights).values({
    id: CONSENT_NIGHT_ID,
    clubId: CONSENT_CLUB_ID,
    scheduledAt: daysAgo(5),
    pickerMembershipId: CS.fay,
    state: "watched",
    winningFilmId: arrivalId,
    lockedAt: daysAgo(6),
    confirmedAt: daysAgo(4),
    confirmedBy: CS.fay,
  });
  const [fayNomination] = await db
    .insert(nominations)
    .values({ nightId: CONSENT_NIGHT_ID, filmId: arrivalId, membershipId: CS.fay })
    .returning({ id: nominations.id });
  await db.insert(votes).values({ nominationId: fayNomination.id, membershipId: CS.fay });
  await db.insert(rsvps).values([
    { nightId: CONSENT_NIGHT_ID, membershipId: CS.fay, status: "yes" },
    { nightId: CONSENT_NIGHT_ID, membershipId: CS.gus, status: "yes" },
  ]);
  const [fayRating] = await db
    .insert(ratings)
    .values({ nightId: CONSENT_NIGHT_ID, membershipId: CS.fay, scoreQuality: "8.0", scoreFun: "7.5", hotTake: "Fay's take" })
    .returning({ id: ratings.id });
  const [fayTag] = await db
    .insert(tags)
    .values({ clubId: CONSENT_CLUB_ID, name: "heady", displayName: "Heady" })
    .returning({ id: tags.id });
  await db.insert(ratingTags).values({ ratingId: fayRating.id, tagId: fayTag.id });
  await db.insert(invites).values({
    id: CONSENT_INVITE.id,
    clubId: CONSENT_CLUB_ID,
    token: CONSENT_INVITE.token,
    inviteeName: CONSENT_INVITE.inviteeName,
    invitedByMembershipId: CS.fay,
  });

  console.log(`Done. Club id: ${CLUB_ID}, second club id: ${CLUB_2_ID}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
