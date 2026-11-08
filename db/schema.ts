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
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Consent and age (docs/onboarding-spec.md §11.1–§11.3). "Under 13" is a
// form answer, never a stored value: nothing about that person persists.
export const ageBracketEnum = pgEnum("age_bracket", ["13_17", "18_plus"]);
export const legalDocumentEnum = pgEnum("legal_document", ["terms", "privacy"]);
export const consentMethodEnum = pgEnum("consent_method", ["signup", "reconsent"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  // "First R." — the person's name in every club, set once at the name
  // step (/welcome) and changeable later. Nullable only until then.
  displayName: text("display_name"),
  avatar: text("avatar"),
  // Trusted tier (analysis-v2.md §5.1) — schema room only, no logic
  // reads this yet. Non-null = trusted, same "nullable timestamp as a
  // flag" shape as memberships.postponed_at/left_at, clubs.paused_at.
  trustedAt: timestamp("trusted_at", { withTimezone: true }),
  // Self-attested, asked once (§11.3). Null = not asked yet; no birthdate.
  ageBracket: ageBracketEnum("age_bracket"),
  ageAttestedAt: timestamp("age_attested_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// One row per sign-in email sent (docs/onboarding-spec.md §4) — email is
// the entire auth mechanism (CLAUDE.md): no passwords, and users.email is
// the durable anchor, so requesting a fresh code is how identity survives
// a cleared cookie or a new device.
export const magicLinks = pgTable("magic_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  // One row, two ways in (docs/onboarding-spec.md §4): the link's token and
  // the 6-digit code, both stored only as hashes (lib/authCredentials.ts).
  // Using either consumes the row.
  tokenHash: text("token_hash").unique(),
  codeHash: text("code_hash"),
  // Wrong code entries against this row; at CODE_MAX_ATTEMPTS it's dead.
  attempts: integer("attempts").notNull().default(0),
  // Set when the code was requested from an invite landing page: completing
  // sign-in then redeems that invite (app/invites.ts).
  inviteId: uuid("invite_id").references(() => invites.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// The session cookie is the only identity mechanism: every membership is
// resolved from session → users.id → that user's active membership in
// the club (app/clubs/[clubId]/identity.ts).
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    // SHA-256 of the cookie's value (lib/authCredentials.ts). A leaked
    // table no longer hands out working sessions.
    tokenHash: text("token_hash").unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

// An email change in progress (docs/onboarding-spec.md §5.9 rulings;
// rebuild step 7b): a code sent to the new address, entered on /settings
// in the signed-in session. Its own table on purpose: sign-in
// (/login/code, /verify, app/signIn.ts) never reads it, so a change code
// can never create or sign in to an account. Only app/emailChange.ts
// touches it (lib/emailChangeAccess.test.ts). The code is stored only as
// an HMAC, like sign-in codes.
export const emailChanges = pgTable(
  "email_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    newEmail: text("new_email").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("email_changes_user_id_idx").on(table.userId),
    index("email_changes_new_email_idx").on(table.newEmail),
  ],
);

// A request to delete the account (docs/onboarding-spec.md §11.4; launch
// foundations (f)): a 6-digit code sent to the account's own address,
// stored only as an HMAC like sign-in codes. Sign-in never reads this
// table, so a deletion code can never sign anyone in. Only
// app/accountDeletion.ts touches it (lib/accountDeletionAccess.test.ts).
export const accountDeletionRequests = pgTable(
  "account_deletion_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("account_deletion_requests_user_id_idx").on(table.userId)],
);

// Every acceptance of the Terms or the Privacy policy, append-only
// (§11.1). An account's current status is each document's newest row
// (lib/consent.ts needsConsent); a version change in lib/legal.ts makes
// that row stale, and the gate in app/auth.ts asks again.
export const consentEvents = pgTable(
  "consent_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    document: legalDocumentEnum("document").notNull(),
    version: text("version").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
    method: consentMethodEnum("method").notNull(),
  },
  (table) => [index("consent_events_user_id_idx").on(table.userId)],
);

// The data-licensing opt-in (§11.2), append-only: opting in inserts a
// row, withdrawing sets its withdrawn_at, and no row is ever deleted. The
// newest row is the current status (lib/consent.ts currentLicensing).
export const dataLicensingConsents = pgTable(
  "data_licensing_consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    wordingVersion: text("wording_version").notNull(),
    optedInAt: timestamp("opted_in_at", { withTimezone: true }).notNull().defaultNow(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  },
  (table) => [index("data_licensing_consents_user_id_idx").on(table.userId)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    // Every membership is a user's — there are no guests
    // (docs/onboarding-spec.md §8.2). Rotation carry-forward on a rejoin
    // matches prior memberships by it; the name comes from users.
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
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
    // One active membership per person per club. Leaving sets left_at, so
    // rejoining inserts a new row (the old one keeps its history); a
    // second *active* row is a rejected insert, the same shape as
    // nights_one_in_flight_per_club.
    uniqueIndex("memberships_one_active_per_user_per_club")
      .on(table.clubId, table.userId)
      .where(sql`${table.leftAt} IS NULL`),
  ],
);

export const films = pgTable("films", {
  id: uuid("id").primaryKey().defaultRandom(),
  tmdbId: integer("tmdb_id").notNull().unique(),
  title: text("title").notNull(),
  year: integer("year").notNull(),
  runtime: integer("runtime"), // minutes
  posterPath: text("poster_path"),
  // Empty text-array defaults (here and watchlist_items.tags) don't
  // round-trip in drizzle-kit 0.31: it reads '{}'::text[] back as '{""}',
  // so every push re-sets them. Harmless; e2e/schemaRoundTrip.ts allows
  // exactly these five statements and nothing else.
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

// Multi-column uniqueness is declared as uniqueIndex(), never unique()
// (a constraint): drizzle-kit 0.31 reads a unique constraint's columns back
// in no fixed order, so pushes kept dropping and re-adding them. A unique
// index enforces the same thing and reads back in its real column order.
// ON CONFLICT targets work the same. e2e/schemaRoundTrip.ts checks every
// E2E run that a second push would change nothing.
export const watchlistItems = pgTable(
  "watchlist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // One list per person, not per membership (docs/onboarding-spec.md §6.1;
    // moved from membership to person in rebuild steps 6a–6e).
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
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
    index("watchlist_items_user_id_idx").on(table.userId),
    index("watchlist_items_film_id_idx").on(table.filmId),
    // A film is on a person's list once: adding it again is a no-op
    // (addToWatchlist's onConflictDoNothing targets this), never a second
    // row that would double-count them in overlap and smart shelves.
    uniqueIndex("watchlist_items_user_id_film_id_unique").on(table.userId, table.filmId),
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
    uniqueIndex("votes_nomination_id_membership_id_unique").on(
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
    uniqueIndex("rsvps_night_id_membership_id_unique").on(
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
    uniqueIndex("ratings_night_id_membership_id_unique").on(
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
    uniqueIndex("tags_club_id_name_unique").on(table.clubId, table.name),
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
    uniqueIndex("rating_tags_rating_id_tag_id_unique").on(table.ratingId, table.tagId),
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

// Per-person invites (docs/onboarding-spec.md §7). One row per person an
// owner or admin adds; the link carries `token`, which is stored as-is so
// the same link can be shared again later. Pending = neither redeemed nor
// revoked, and a pending invite holds one of the club's seats. Redeemed
// rows are kept, not deleted: invited_by is the provenance record the
// trust signals rely on (analysis-v2.md §5.2).
export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    token: text("token").notNull().unique(),
    // "Marco R." — a greeting and the name step's prefill, nothing more.
    inviteeName: text("invitee_name").notNull(),
    invitedByMembershipId: uuid("invited_by_membership_id")
      .notNull()
      .references(() => memberships.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // First time someone submitted an email on the landing page. Not set
    // on GET: link-preview crawlers open every URL in a group chat.
    startedAt: timestamp("started_at", { withTimezone: true }),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    redeemedByUserId: uuid("redeemed_by_user_id").references(() => users.id),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [index("invites_club_id_idx").on(table.clubId)],
);
