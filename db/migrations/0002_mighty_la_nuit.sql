ALTER TABLE "constraints" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "films" ADD COLUMN "genre_ids" integer[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "films" ADD COLUMN "keyword_ids" integer[] DEFAULT '{}' NOT NULL;