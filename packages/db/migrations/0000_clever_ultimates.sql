CREATE TYPE "public"."limit_event_type" AS ENUM('daily_loss', 'cooldown', 'size_cap');--> statement-breakpoint
CREATE TYPE "public"."mistake_tag" AS ENUM('oversized', 'ignored_red_flag', 'emotional_entry', 'no_exit_plan', 'other');--> statement-breakpoint
CREATE TYPE "public"."position_mode" AS ENUM('paper', 'live');--> statement-breakpoint
CREATE TYPE "public"."position_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."regime" AS ENUM('HOT', 'NEUTRAL', 'COLD');--> statement-breakpoint
CREATE TYPE "public"."trade_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."verdict" AS ENUM('PASS', 'BLOCKED', 'UNVERIFIED');--> statement-breakpoint
CREATE TABLE "alert_outcomes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"mint" text NOT NULL,
	"risk_report_id" integer,
	"base_ts" timestamp with time zone NOT NULL,
	"base_price" numeric(30, 10),
	"base_market_cap" numeric(30, 10),
	"offset_minutes" integer NOT NULL,
	"price" numeric(30, 10),
	"market_cap" numeric(30, 10),
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creators" (
	"wallet" text PRIMARY KEY NOT NULL,
	"tokens_launched" integer DEFAULT 0 NOT NULL,
	"tokens_rugged" integer DEFAULT 0 NOT NULL,
	"last_checked" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"position_id" uuid,
	"thesis" text NOT NULL,
	"outcome_notes" text,
	"mistake_tag" "mistake_tag",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "limit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "limit_event_type" NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"mint" text NOT NULL,
	"mode" "position_mode" NOT NULL,
	"entry_price" numeric(30, 10) NOT NULL,
	"size_sol" numeric(30, 10) NOT NULL,
	"status" "position_status" DEFAULT 'open' NOT NULL,
	"thesis" text NOT NULL,
	"exit_plan" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "regime_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"btc_trend" text,
	"eth_trend" text,
	"sol_trend" text,
	"memecoin_volume_index" numeric(18, 6),
	"avg_peak_mcap" numeric(30, 10),
	"regime" "regime" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"mint" text NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"verdict" "verdict" NOT NULL,
	"score" integer,
	"hard_fail_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"score_breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_sources" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"mint" text NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"price" numeric(30, 10),
	"market_cap" numeric(30, 10),
	"liquidity_usd" numeric(30, 10),
	"volume_5m" numeric(30, 10),
	"volume_1h" numeric(30, 10),
	"volume_24h" numeric(30, 10),
	"holders" integer,
	"top1_pct" numeric(9, 4),
	"top5_pct" numeric(9, 4),
	"top10_pct" numeric(9, 4),
	"fees_paid_sol" numeric(30, 10)
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"mint" text PRIMARY KEY NOT NULL,
	"symbol" text,
	"name" text,
	"chain" text DEFAULT 'solana' NOT NULL,
	"created_at" timestamp with time zone,
	"creator_wallet" text,
	"launchpad" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position_id" uuid NOT NULL,
	"side" "trade_side" NOT NULL,
	"price" numeric(30, 10) NOT NULL,
	"amount" numeric(30, 10) NOT NULL,
	"slippage_pct" numeric(9, 4),
	"tx_signature" text,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "users_wallet_address_unique" UNIQUE("wallet_address")
);
--> statement-breakpoint
CREATE TABLE "wallet_links" (
	"mint" text NOT NULL,
	"wallet" text NOT NULL,
	"cluster_id" text,
	"funding_source" text,
	"wallet_age_days" integer,
	"is_fresh" boolean,
	"is_bundler_flag" boolean,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_links_mint_wallet_pk" PRIMARY KEY("mint","wallet")
);
--> statement-breakpoint
ALTER TABLE "alert_outcomes" ADD CONSTRAINT "alert_outcomes_mint_tokens_mint_fk" FOREIGN KEY ("mint") REFERENCES "public"."tokens"("mint") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "limit_events" ADD CONSTRAINT "limit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_mint_tokens_mint_fk" FOREIGN KEY ("mint") REFERENCES "public"."tokens"("mint") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_reports" ADD CONSTRAINT "risk_reports_mint_tokens_mint_fk" FOREIGN KEY ("mint") REFERENCES "public"."tokens"("mint") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_snapshots" ADD CONSTRAINT "token_snapshots_mint_tokens_mint_fk" FOREIGN KEY ("mint") REFERENCES "public"."tokens"("mint") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_links" ADD CONSTRAINT "wallet_links_mint_tokens_mint_fk" FOREIGN KEY ("mint") REFERENCES "public"."tokens"("mint") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_outcomes_mint_base_idx" ON "alert_outcomes" USING btree ("mint","base_ts","offset_minutes");--> statement-breakpoint
CREATE INDEX "journal_entries_user_idx" ON "journal_entries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "limit_events_user_ts_idx" ON "limit_events" USING btree ("user_id","ts");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "positions_user_status_idx" ON "positions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "positions_mint_idx" ON "positions" USING btree ("mint");--> statement-breakpoint
CREATE INDEX "risk_reports_mint_ts_idx" ON "risk_reports" USING btree ("mint","ts");--> statement-breakpoint
CREATE INDEX "risk_reports_verdict_idx" ON "risk_reports" USING btree ("verdict");--> statement-breakpoint
CREATE INDEX "token_snapshots_mint_ts_idx" ON "token_snapshots" USING btree ("mint","ts");--> statement-breakpoint
CREATE INDEX "tokens_first_seen_idx" ON "tokens" USING btree ("first_seen_at");--> statement-breakpoint
CREATE INDEX "tokens_creator_idx" ON "tokens" USING btree ("creator_wallet");--> statement-breakpoint
CREATE INDEX "trades_position_idx" ON "trades" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "wallet_links_cluster_idx" ON "wallet_links" USING btree ("mint","cluster_id");