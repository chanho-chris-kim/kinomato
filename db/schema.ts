import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// analysis-v1.md §3.2 (base schema, still the source since analysis-v2.md
// doesn't restate one) + watchlist-spec.md §5 (films/watchlist_items
// additions, film_facts, club_connections) + every ruling in CLAUDE.md
// since: memberships.postponed_at, clubs.settings, clubs.paused_at,
// nights.club_connections, per-member veto pool (no schema change needed —
// counted from vetoes rows).

export const cadenceEnum = pgEnum("cadence", [
  "weekly",
  "biweekly",
  "monthly",
  "ad_hoc",
]);

export const clubModeEnum = pgEnum("club_mode", ["in_person", "remote"]);

// Owner/Admin/Member/Guest are stored. Host and Picker are never stored —
// both are computed by lib/rotation.ts, per "Rotation is computed, never
// stored." nights.host_membership_id / picker_membership_id below are the
// historical record of who held those roles for a specific night, not a
// live pointer.
export const membershipRoleEnum = pgEnum("membership_role", [
  "owner",
  "admin",
  "member",
  "guest",
]);

export const constraintKindEnum = pgEnum("constraint_kind", ["hard", "soft"]);

// No "rating" — an age-rating ceiling is a club-level filter
// (films.certification), never a per-member constraint.
export const constraintRuleTypeEnum = pgEnum("constraint_rule_type", [
  "genre",
  "keyword",
  "runtime",
  "language",
]);

export const nightStateEnum = pgEnum("night_state", [
  "draft",
  "open",
  "locked",
  "watched",
  "cancelled",
  "unconfirmed",
]);

export const rsvpStatusEnum = pgEnum("rsvp_status", ["yes", "no"]);

export const filmFactSourceEnum = pgEnum("film_fact_source", [
  "tmdb",
  "wikidata",
  "derived",
]);

export const clubs = pgTable("clubs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  cadence: cadenceEnum("cadence").notNull().default("weekly"),
  defaultDay: smallint("default_day"), // 0=Sunday..6=Saturday
  defaultTime: time("default_time"),
  timezone: text("timezone").notNull(),
  mode: clubModeEnum("mode").notNull(),
  theme: text("theme").notNull().default("late-show"),
  // Admin-flexibility settings (analysis-v2.md §2) as one JSONB column,
  // per the "not eight nullable fields" convention.
  settings: jsonb("settings").notNull().default({}),
  // Non-null = the club (and its rotation) is paused. Same shape as
  // memberships.postponed_at.
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  // Required on /join as a query param (CLAUDE.md) — a club id alone no
  // longer admits a joiner. Minted with the same crypto.randomUUID()
  // convention every other generated id in this app already uses, not
  // a shorter/URL-friendlier format invented just for this. Rotating
  // it (owner/admin only, same restriction precedent as lockNight)
  // just overwrites this column — old links start failing immediately,
  // nothing to expire or garbage-collect.
  inviteToken: text("invite_token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  avatar: text("avatar"),
  // Trusted tier (analysis-v2.md §5.1) — schema room only, no logic
  // reads this yet. Non-null = trusted, same "nullable timestamp as a
  // flag" shape as memberships.postponed_at/left_at, clubs.paused_at.
  trustedAt: timestamp("trusted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// A magic link is the entire auth mechanism (CLAUDE.md) — no passwords,
// no session-independent "remember me": the users.email row is the
// durable anchor, and requesting a fresh link is how identity survives
// a cleared cookie or a new device, not some unclearable cookie.
// claimMembershipId is what distinguishes the two flows this table
// serves: null is a plain login/recovery link; set means verifying
// this link updates that membership row in place (userId and
// identityKey both set to the resulting users.id) rather than ever
// creating a new one — CLAUDE.md's claim ruling, load-bearing for
// rotation continuity.
export const magicLinks = pgTable("magic_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  token: text("token").notNull().unique(),
  claimMembershipId: uuid("claim_membership_id").references(() => memberships.id),
  // Where to land after verifying — a club id, so both a claim and a
  // plain recovery login return to where the person actually was
  // instead of a dead end. Null for a bare /login with no club context.
  returnToClubId: uuid("return_to_club_id").references(() => clubs.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Site-wide, unlike every other identity mechanism in this app —
// kinomato_identity_{clubId} stays per-club and unchanged (CLAUDE.md);
// this is the one cookie that isn't scoped to a club, since "who is
// this verified person" has to be answered before "which membership
// row are they in this club" can be.
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    // Nullable: v0 has no auth, guests have no users row.
    userId: uuid("user_id").references(() => users.id),
    // Stable per-club identity for rotation carry-forward: the user's id
    // where there is one, otherwise a per-club token minted on first join
    // and stored in the guest's invite cookie. Always present, unlike
    // userId — this is what closes the "leave and rejoin as a fresh
    // guest to skip the queue" hole. A guest who clears cookies gets a
    // new identityKey and genuinely can't be matched; accepted, not
    // handled.
    identityKey: text("identity_key").notNull(),
    displayName: text("display_name").notNull(),
    role: membershipRoleEnum("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
    // Postponement is a membership property, not a night state. Non-null
    // means this member is at the front of the queue, waiting to pick.
    postponedAt: timestamp("postponed_at", { withTimezone: true }),
  },
  (table) => [
    index("memberships_club_id_idx").on(table.clubId),
    index("memberships_club_id_identity_key_idx").on(
      table.clubId,
      table.identityKey,
    ),
  ],
);

export const films = pgTable("films", {
  id: uuid("id").primaryKey().defaultRandom(),
  tmdbId: integer("tmdb_id").notNull().unique(),
  title: text("title").notNull(),
  year: integer("year").notNull(),
  runtime: integer("runtime"), // minutes
  posterPath: text("poster_path"),
  genres: text("genres").array().notNull().default([]), // display strings
  // TMDB genre/keyword ids, for matching. Constraint values match on
  // these, never on the display strings above — "Sci-Fi" vs "Science
  // Fiction" must never silently fail a hard limit.
  genreIds: integer("genre_ids").array().notNull().default([]),
  keywordIds: integer("keyword_ids").array().notNull().default([]),
  // Nullable and expected to be patchy (TMDB sources it per-country via
  // release_dates). A missing value means unknown, never "allowed" — the
  // club-level age-rating ceiling filter treats null as excluded.
  // One global value per film — multi-country certification is
  // deliberately deferred (CLAUDE.md Open Questions), not built. Nothing
  // depends on this yet: the age-ceiling setting isn't exposed in any UI.
  certification: text("certification"),
  directors: text("directors").array().notNull().default([]),
  cast: text("cast").array().notNull().default([]), // top 5
  keywords: text("keywords").array().notNull().default([]), // display strings
  primaryGenre: text("primary_genre"),
  country: text("country"),
  originalLanguage: text("original_language"),
  releaseDate: date("release_date"),
  budget: bigint("budget", { mode: "number" }),
  revenue: bigint("revenue", { mode: "number" }),
  cachedAt: timestamp("cached_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const watchlistItems = pgTable(
  "watchlist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id),
    filmId: uuid("film_id")
      .notNull()
      .references(() => films.id),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    note: text("note"),
    tags: text("tags").array().notNull().default([]),
  },
  (table) => [
    index("watchlist_items_membership_id_idx").on(table.membershipId),
    index("watchlist_items_film_id_idx").on(table.filmId),
    // Adding the same film twice is a no-op (onConflictDoNothing at the
    // insert site), not a duplicate row — a duplicate would double-count
    // this person in every overlap/smart-shelf calculation.
    unique("watchlist_items_membership_id_film_id_unique").on(
      table.membershipId,
      table.filmId,
    ),
  ],
);

export const constraints = pgTable(
  "constraints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id),
    kind: constraintKindEnum("kind").notNull(),
    ruleType: constraintRuleTypeEnum("rule_type").notNull(),
    // For genre/keyword: the TMDB id, as text (matching is on ids only,
    // never display strings). For language: an ISO 639-1 code. For
    // runtime: whole minutes, upper bound.
    value: text("value").notNull(),
    // UI-only. Genre/keyword matching never reads this — it exists so
    // the UI doesn't have to look the id back up to render a label.
    label: text("label"),
    // Default false. Hard limits apply unless the member explicitly
    // RSVP'd no; soft preferences apply only to an explicit yes. This
    // overrides both regardless of RSVP status.
    appliesWhenAbsent: boolean("applies_when_absent").notNull().default(false),
  },
  (table) => [index("constraints_membership_id_idx").on(table.membershipId)],
);

export const seasons = pgTable(
  "seasons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [index("seasons_club_id_idx").on(table.clubId)],
);

export const nights = pgTable(
  "nights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    hostMembershipId: uuid("host_membership_id").references(
      () => memberships.id,
    ),
    pickerMembershipId: uuid("picker_membership_id")
      .notNull()
      .references(() => memberships.id),
    state: nightStateEnum("state").notNull().default("draft"),
    winningFilmId: uuid("winning_film_id").references(() => films.id),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedBy: uuid("confirmed_by").references(() => memberships.id),
    // Best shared-history connection (director/actor/country/decade),
    // computed once at lock and cached here — a query, not a job.
    clubConnections: jsonb("club_connections"),
  },
  (table) => [
    index("nights_club_id_idx").on(table.clubId),
    // A club has at most one night in flight. draft/open/locked are
    // non-terminal; watched/cancelled/unconfirmed are terminal and can
    // stack up freely. Enforced here, not by the page picking between
    // candidates, so a second in-flight night is a rejected insert, not a
    // UI ambiguity.
    uniqueIndex("nights_one_in_flight_per_club")
      .on(table.clubId)
      .where(sql`${table.state} IN ('draft', 'open', 'locked')`),
  ],
);

export const nominations = pgTable(
  "nominations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nightId: uuid("night_id")
      .notNull()
      .references(() => nights.id),
    filmId: uuid("film_id")
      .notNull()
      .references(() => films.id),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id),
  },
  (table) => [index("nominations_night_id_idx").on(table.nightId)],
);

// Attribution (membershipId) is retained permanently — it's the audit
// trail. Access, not deletion, is the control: a single history-read
// module is the only code path permitted to query this table, and it
// never selects membershipId except when a member reads their own vote.
export const votes = pgTable(
  "votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nominationId: uuid("nomination_id")
      .notNull()
      .references(() => nominations.id),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("votes_nomination_id_idx").on(table.nominationId),
    // A member can only vote once for a given nominee. "One vote per
    // night, movable" is enforced in the vote server action (delete any
    // existing vote for this membership across the night's other
    // nominations, then insert), not by a constraint here — a night has
    // several nominations, so that rule can't be a single-table unique
    // index.
    unique("votes_nomination_id_membership_id_unique").on(
      table.nominationId,
      table.membershipId,
    ),
  ],
);

export const rsvps = pgTable(
  "rsvps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nightId: uuid("night_id")
      .notNull()
      .references(() => nights.id),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id),
    status: rsvpStatusEnum("status"), // null = no response yet
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("rsvps_night_id_idx").on(table.nightId),
    // One RSVP row per member per night — the RSVP action upserts on
    // this.
    unique("rsvps_night_id_membership_id_unique").on(
      table.nightId,
      table.membershipId,
    ),
  ],
);

// Same retention rule as votes: membershipId (the vetoer) is never
// deleted. It's shown live so a veto reads as a boundary, then hidden by
// the same history-read module once the night closes.
export const vetoes = pgTable(
  "vetoes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nightId: uuid("night_id")
      .notNull()
      .references(() => nights.id),
    nominationId: uuid("nomination_id")
      .notNull()
      .references(() => nominations.id),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Per-member-per-season token pool is enforced by counting rows here,
    // not by a separate balance column.
    index("vetoes_membership_id_season_id_idx").on(
      table.membershipId,
      table.seasonId,
    ),
  ],
);

export const ratings = pgTable(
  "ratings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nightId: uuid("night_id")
      .notNull()
      .references(() => nights.id),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id),
    scoreQuality: numeric("score_quality", { precision: 3, scale: 1 }).notNull(),
    scoreFun: numeric("score_fun", { precision: 3, scale: 1 }).notNull(),
    hotTake: text("hot_take"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("ratings_night_id_idx").on(table.nightId),
    // One rating per member per night — the rating action upserts on
    // this, and the blind-reveal count (lib/ratingReveal.ts) depends on
    // rows here being one-per-member, not one-per-submit.
    unique("ratings_night_id_membership_id_unique").on(
      table.nightId,
      table.membershipId,
    ),
  ],
);

// Club-scoped on purpose (CLAUDE.md) — "cozy" is one tag per club, not
// one per member and not a cross-club/global vocabulary. name is the
// normalized matching key (lib/tags.ts: trim, lowercase, collapse inner
// whitespace); displayName is the first-seen casing, shown in the UI —
// matching lib/tmdb.ts's "value vs label" split for constraints, never
// the reverse.
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    name: text("name").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("tags_club_id_idx").on(table.clubId),
    // One row per normalized name per club — adding an existing tag
    // upserts onto this rather than creating a near-duplicate.
    unique("tags_club_id_name_unique").on(table.clubId, table.name),
  ],
);

export const ratingTags = pgTable(
  "rating_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ratingId: uuid("rating_id")
      .notNull()
      .references(() => ratings.id),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id),
  },
  (table) => [
    index("rating_tags_rating_id_idx").on(table.ratingId),
    index("rating_tags_tag_id_idx").on(table.tagId),
    unique("rating_tags_rating_id_tag_id_unique").on(table.ratingId, table.tagId),
  ],
);

export const filmFacts = pgTable(
  "film_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    filmId: uuid("film_id")
      .notNull()
      .references(() => films.id),
    text: text("text").notNull(),
    source: filmFactSourceEnum("source").notNull(),
    sourceUrl: text("source_url"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
  },
  (table) => [index("film_facts_film_id_idx").on(table.filmId)],
);
