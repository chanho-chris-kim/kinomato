ALTER TABLE "memberships" ADD COLUMN "identity_key" text NOT NULL;--> statement-breakpoint
CREATE INDEX "memberships_club_id_identity_key_idx" ON "memberships" USING btree ("club_id","identity_key");