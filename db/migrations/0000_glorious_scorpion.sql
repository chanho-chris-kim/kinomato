CREATE TYPE "public"."cadence" AS ENUM('weekly', 'biweekly', 'monthly', 'ad_hoc');--> statement-breakpoint
CREATE TYPE "public"."club_mode" AS ENUM('in_person', 'remote');--> statement-breakpoint
CREATE TYPE "public"."constraint_kind" AS ENUM('hard', 'soft');--> statement-breakpoint
CREATE TYPE "public"."constraint_rule_type" AS ENUM('genre', 'keyword', 'runtime', 'language');--> statement-breakpoint
CREATE TYPE "public"."film_fact_source" AS ENUM('tmdb', 'wikidata', 'derived');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'admin', 'member', 'guest');--> statement-breakpoint
CREATE TYPE "public"."night_state" AS ENUM('draft', 'open', 'locked', 'watched', 'cancelled', 'unconfirmed');--> statement-breakpoint
CREATE TYPE "public"."rsvp_status" AS ENUM('yes', 'no');--> statement-breakpoint
CREATE TABLE "clubs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"cadence" "cadence" DEFAULT 'weekly' NOT NULL,
	"default_day" smallint,
	"default_time" time,
	"timezone" text NOT NULL,
	"mode" "club_mode" NOT NULL,
	"theme" text DEFAULT 'late-show' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"paused_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "constraints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"kind" "constraint_kind" NOT NULL,
	"rule_type" "constraint_rule_type" NOT NULL,
	"value" text NOT NULL,
	"applies_when_absent" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "film_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"film_id" uuid NOT NULL,
	"text" text NOT NULL,
	"source" "film_fact_source" NOT NULL,
	"source_url" text,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "films" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tmdb_id" integer NOT NULL,
	"title" text NOT NULL,
	"year" integer NOT NULL,
	"runtime" integer,
	"poster_path" text,
	"genres" text[] DEFAULT '{}' NOT NULL,
	"certification" text,
	"directors" text[] DEFAULT '{}' NOT NULL,
	"cast" text[] DEFAULT '{}' NOT NULL,
	"keywords" text[] DEFAULT '{}' NOT NULL,
	"primary_genre" text,
	"country" text,
	"original_language" text,
	"release_date" date,
	"budget" bigint,
	"revenue" bigint,
	"cached_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "films_tmdb_id_unique" UNIQUE("tmdb_id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"user_id" uuid,
	"display_name" text NOT NULL,
	"role" "membership_role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"postponed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "nights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"host_membership_id" uuid,
	"picker_membership_id" uuid NOT NULL,
	"state" "night_state" DEFAULT 'draft' NOT NULL,
	"winning_film_id" uuid,
	"locked_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"club_connections" jsonb
);
--> statement-breakpoint
CREATE TABLE "nominations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"night_id" uuid NOT NULL,
	"film_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"night_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"score_quality" numeric(3, 1) NOT NULL,
	"score_fun" numeric(3, 1) NOT NULL,
	"hot_take" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rsvps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"night_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"status" "rsvp_status",
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"avatar" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vetoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"night_id" uuid NOT NULL,
	"nomination_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nomination_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"film_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"tags" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "constraints" ADD CONSTRAINT "constraints_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_facts" ADD CONSTRAINT "film_facts_film_id_films_id_fk" FOREIGN KEY ("film_id") REFERENCES "public"."films"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nights" ADD CONSTRAINT "nights_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nights" ADD CONSTRAINT "nights_host_membership_id_memberships_id_fk" FOREIGN KEY ("host_membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nights" ADD CONSTRAINT "nights_picker_membership_id_memberships_id_fk" FOREIGN KEY ("picker_membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nights" ADD CONSTRAINT "nights_winning_film_id_films_id_fk" FOREIGN KEY ("winning_film_id") REFERENCES "public"."films"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nights" ADD CONSTRAINT "nights_confirmed_by_memberships_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nominations" ADD CONSTRAINT "nominations_night_id_nights_id_fk" FOREIGN KEY ("night_id") REFERENCES "public"."nights"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nominations" ADD CONSTRAINT "nominations_film_id_films_id_fk" FOREIGN KEY ("film_id") REFERENCES "public"."films"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nominations" ADD CONSTRAINT "nominations_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_night_id_nights_id_fk" FOREIGN KEY ("night_id") REFERENCES "public"."nights"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvps" ADD CONSTRAINT "rsvps_night_id_nights_id_fk" FOREIGN KEY ("night_id") REFERENCES "public"."nights"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvps" ADD CONSTRAINT "rsvps_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vetoes" ADD CONSTRAINT "vetoes_night_id_nights_id_fk" FOREIGN KEY ("night_id") REFERENCES "public"."nights"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vetoes" ADD CONSTRAINT "vetoes_nomination_id_nominations_id_fk" FOREIGN KEY ("nomination_id") REFERENCES "public"."nominations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vetoes" ADD CONSTRAINT "vetoes_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vetoes" ADD CONSTRAINT "vetoes_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_nomination_id_nominations_id_fk" FOREIGN KEY ("nomination_id") REFERENCES "public"."nominations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_film_id_films_id_fk" FOREIGN KEY ("film_id") REFERENCES "public"."films"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "constraints_membership_id_idx" ON "constraints" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "film_facts_film_id_idx" ON "film_facts" USING btree ("film_id");--> statement-breakpoint
CREATE INDEX "memberships_club_id_idx" ON "memberships" USING btree ("club_id");--> statement-breakpoint
CREATE INDEX "nights_club_id_idx" ON "nights" USING btree ("club_id");--> statement-breakpoint
CREATE INDEX "nominations_night_id_idx" ON "nominations" USING btree ("night_id");--> statement-breakpoint
CREATE INDEX "ratings_night_id_idx" ON "ratings" USING btree ("night_id");--> statement-breakpoint
CREATE INDEX "rsvps_night_id_idx" ON "rsvps" USING btree ("night_id");--> statement-breakpoint
CREATE INDEX "seasons_club_id_idx" ON "seasons" USING btree ("club_id");--> statement-breakpoint
CREATE INDEX "vetoes_membership_id_season_id_idx" ON "vetoes" USING btree ("membership_id","season_id");--> statement-breakpoint
CREATE INDEX "votes_nomination_id_idx" ON "votes" USING btree ("nomination_id");--> statement-breakpoint
CREATE INDEX "watchlist_items_membership_id_idx" ON "watchlist_items" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "watchlist_items_film_id_idx" ON "watchlist_items" USING btree ("film_id");