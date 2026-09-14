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
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  avatar: text("avatar"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    // Nullable: v0 has no auth, guests have no users row.
    userId: uuid("user_id").references(() => users.id),
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
  (table) => [index("memberships_club_id_idx").on(table.clubId)],
);

export const films = pgTable("films", {
  id: uuid("id").primaryKey().defaultRandom(),
  tmdbId: integer("tmdb_id").notNull().unique(),
  title: text("title").notNull(),
  year: integer("year").notNull(),
  runtime: integer("runtime"), // minutes
  posterPath: text("poster_path"),
  genres: text("genres").array().notNull().default([]),
  // Nullable and expected to be patchy (TMDB sources it per-country via
  // release_dates). A missing value means unknown, never "allowed" — the
  // club-level age-rating ceiling filter must treat null as excluded.
  certification: text("certification"),
  directors: text("directors").array().notNull().default([]),
  cast: text("cast").array().notNull().default([]), // top 5
  keywords: text("keywords").array().notNull().default([]),
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
    value: text("value").notNull(),
    // Default false: constraints scope to yes-RSVPs. True opts a member's
    // limits into applying even when they're not coming.
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
  (table) => [index("nights_club_id_idx").on(table.clubId)],
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
  (table) => [index("votes_nomination_id_idx").on(table.nominationId)],
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
  (table) => [index("rsvps_night_id_idx").on(table.nightId)],
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
  (table) => [index("ratings_night_id_idx").on(table.nightId)],
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
