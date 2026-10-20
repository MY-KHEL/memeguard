ALTER TABLE "users" ADD COLUMN "paper_balance_sol" numeric(30, 10) DEFAULT '50' NOT NULL;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "remaining_tokens" numeric(30, 10) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "remaining_cost_sol" numeric(30, 10) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "token_decimals" integer DEFAULT 6 NOT NULL;
