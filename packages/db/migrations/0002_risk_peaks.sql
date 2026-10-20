ALTER TABLE "tokens" ADD COLUMN "peak_liquidity_usd" numeric(30, 10);--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "rug_detected_at" timestamp with time zone;
