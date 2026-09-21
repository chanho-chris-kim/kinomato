CREATE TABLE "rating_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rating_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "rating_tags_rating_id_tag_id_unique" UNIQUE("rating_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_club_id_name_unique" UNIQUE("club_id","name")
);
--> statement-breakpoint
ALTER TABLE "rating_tags" ADD CONSTRAINT "rating_tags_rating_id_ratings_id_fk" FOREIGN KEY ("rating_id") REFERENCES "public"."ratings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_tags" ADD CONSTRAINT "rating_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rating_tags_rating_id_idx" ON "rating_tags" USING btree ("rating_id");--> statement-breakpoint
CREATE INDEX "rating_tags_tag_id_idx" ON "rating_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "tags_club_id_idx" ON "tags" USING btree ("club_id");