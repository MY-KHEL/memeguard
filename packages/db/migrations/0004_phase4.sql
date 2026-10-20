ALTER TABLE "notifications" ADD COLUMN "dedup_key" text;--> statement-breakpoint
UPDATE "notifications" SET "dedup_key" = "id"::text WHERE "dedup_key" IS NULL;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "dedup_key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_dedup_idx" ON "notifications" USING btree ("user_id","dedup_key");
