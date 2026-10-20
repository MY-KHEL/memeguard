ALTER TABLE "tokens" ADD COLUMN "pair_address" text;--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "dex_id" text;--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "latest_price" numeric(30, 10);--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "latest_market_cap" numeric(30, 10);--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "latest_liquidity_usd" numeric(30, 10);--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "latest_volume_24h" numeric(30, 10);--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "latest_price_change_1h" numeric(9, 4);--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "last_snapshot_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "tokens_symbol_idx" ON "tokens" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "tokens_last_snapshot_idx" ON "tokens" USING btree ("last_snapshot_at");--> statement-breakpoint
CREATE INDEX "tokens_latest_mcap_idx" ON "tokens" USING btree ("latest_market_cap");--> statement-breakpoint
CREATE INDEX "tokens_latest_vol24_idx" ON "tokens" USING btree ("latest_volume_24h");