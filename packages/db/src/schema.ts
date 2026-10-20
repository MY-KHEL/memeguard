import {
  bigserial,
  boolean,
  index,
  integer,
  uniqueIndex,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import {
  LIMIT_EVENT_TYPES,
  MISTAKE_TAGS,
  POSITION_MODES,
  REGIMES,
  VERDICTS,
} from "@meme-guard/shared-types";

// Tables follow docs/SPEC.md section 4. Column names are snake_case in Postgres.

export const verdictEnum = pgEnum("verdict", VERDICTS);
export const positionModeEnum = pgEnum("position_mode", POSITION_MODES);
export const positionStatusEnum = pgEnum("position_status", ["open", "closed"]);
export const tradeSideEnum = pgEnum("trade_side", ["buy", "sell"]);
export const regimeEnum = pgEnum("regime", REGIMES);
export const limitEventTypeEnum = pgEnum("limit_event_type", LIMIT_EVENT_TYPES);
export const mistakeTagEnum = pgEnum("mistake_tag", MISTAKE_TAGS);

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const money = (name: string) => numeric(name, { precision: 30, scale: 10 });
const pct = (name: string) => numeric(name, { precision: 9, scale: 4 });

export const tokens = pgTable(
  "tokens",
  {
    mint: text("mint").primaryKey(),
    symbol: text("symbol"),
    name: text("name"),
    chain: text("chain").notNull().default("solana"),
    createdAt: ts("created_at"),
    creatorWallet: text("creator_wallet"),
    launchpad: text("launchpad"),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    // Phase 1: denormalised latest market fields so the Explore list is one indexed query.
    pairAddress: text("pair_address"),
    dexId: text("dex_id"),
    imageUrl: text("image_url"),
    latestPrice: money("latest_price"),
    latestMarketCap: money("latest_market_cap"),
    latestLiquidityUsd: money("latest_liquidity_usd"),
    latestVolume24h: money("latest_volume_24h"),
    latestPriceChange1h: pct("latest_price_change_1h"),
    lastSnapshotAt: ts("last_snapshot_at"),
    peakLiquidityUsd: money("peak_liquidity_usd"),
    rugDetectedAt: ts("rug_detected_at"),
  },
  (t) => [
    index("tokens_first_seen_idx").on(t.firstSeenAt),
    index("tokens_creator_idx").on(t.creatorWallet),
    index("tokens_symbol_idx").on(t.symbol),
    index("tokens_last_snapshot_idx").on(t.lastSnapshotAt),
    index("tokens_latest_mcap_idx").on(t.latestMarketCap),
    index("tokens_latest_vol24_idx").on(t.latestVolume24h),
  ],
);

export const tokenSnapshots = pgTable(
  "token_snapshots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    mint: text("mint")
      .notNull()
      .references(() => tokens.mint, { onDelete: "cascade" }),
    ts: ts("ts").notNull().defaultNow(),
    price: money("price"),
    marketCap: money("market_cap"),
    liquidityUsd: money("liquidity_usd"),
    volume5m: money("volume_5m"),
    volume1h: money("volume_1h"),
    volume24h: money("volume_24h"),
    holders: integer("holders"),
    top1Pct: pct("top1_pct"),
    top5Pct: pct("top5_pct"),
    top10Pct: pct("top10_pct"),
    feesPaidSol: money("fees_paid_sol"),
  },
  (t) => [index("token_snapshots_mint_ts_idx").on(t.mint, t.ts)],
);

export const riskReports = pgTable(
  "risk_reports",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    mint: text("mint")
      .notNull()
      .references(() => tokens.mint, { onDelete: "cascade" }),
    ts: ts("ts").notNull().defaultNow(),
    verdict: verdictEnum("verdict").notNull(),
    score: integer("score"),
    hardFailReasons: jsonb("hard_fail_reasons").notNull().default([]),
    scoreBreakdown: jsonb("score_breakdown").notNull().default({}),
    rawSources: jsonb("raw_sources").notNull().default({}),
    configVersion: text("config_version").notNull(),
  },
  (t) => [index("risk_reports_mint_ts_idx").on(t.mint, t.ts), index("risk_reports_verdict_idx").on(t.verdict)],
);

export const walletLinks = pgTable(
  "wallet_links",
  {
    mint: text("mint")
      .notNull()
      .references(() => tokens.mint, { onDelete: "cascade" }),
    wallet: text("wallet").notNull(),
    clusterId: text("cluster_id"),
    fundingSource: text("funding_source"),
    walletAgeDays: integer("wallet_age_days"),
    isFresh: boolean("is_fresh"),
    isBundlerFlag: boolean("is_bundler_flag"),
    checkedAt: ts("checked_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.mint, t.wallet] }), index("wallet_links_cluster_idx").on(t.mint, t.clusterId)],
);

export const creators = pgTable("creators", {
  wallet: text("wallet").primaryKey(),
  tokensLaunched: integer("tokens_launched").notNull().default(0),
  tokensRugged: integer("tokens_rugged").notNull().default(0),
  lastChecked: ts("last_checked"),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  walletAddress: text("wallet_address").notNull().unique(),
  createdAt: ts("created_at").notNull().defaultNow(),
  settings: jsonb("settings").notNull().default({}),
  paperBalanceSol: money("paper_balance_sol").notNull().default("50"),
});

export const positions = pgTable(
  "positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mint: text("mint")
      .notNull()
      .references(() => tokens.mint),
    mode: positionModeEnum("mode").notNull(),
    entryPrice: money("entry_price").notNull(),
    sizeSol: money("size_sol").notNull(),
    status: positionStatusEnum("status").notNull().default("open"),
    thesis: text("thesis").notNull(),
    exitPlan: jsonb("exit_plan").notNull().default({}),
    remainingTokens: money("remaining_tokens").notNull().default("0"),
    remainingCostSol: money("remaining_cost_sol").notNull().default("0"),
    tokenDecimals: integer("token_decimals").notNull().default(6),
    openedAt: ts("opened_at").notNull().defaultNow(),
    closedAt: ts("closed_at"),
  },
  (t) => [index("positions_user_status_idx").on(t.userId, t.status), index("positions_mint_idx").on(t.mint)],
);

export const trades = pgTable(
  "trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    positionId: uuid("position_id")
      .notNull()
      .references(() => positions.id, { onDelete: "cascade" }),
    side: tradeSideEnum("side").notNull(),
    price: money("price").notNull(),
    amount: money("amount").notNull(),
    slippagePct: pct("slippage_pct"),
    txSignature: text("tx_signature"),
    ts: ts("ts").notNull().defaultNow(),
  },
  (t) => [index("trades_position_idx").on(t.positionId)],
);

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    positionId: uuid("position_id").references(() => positions.id, { onDelete: "set null" }),
    thesis: text("thesis").notNull(),
    outcomeNotes: text("outcome_notes"),
    mistakeTag: mistakeTagEnum("mistake_tag"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("journal_entries_user_idx").on(t.userId, t.createdAt)],
);

export const limitEvents = pgTable(
  "limit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: limitEventTypeEnum("type").notNull(),
    ts: ts("ts").notNull().defaultNow(),
    detail: jsonb("detail").notNull().default({}),
  },
  (t) => [index("limit_events_user_ts_idx").on(t.userId, t.ts)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    dedupKey: text("dedup_key").notNull(),
    readAt: ts("read_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("notifications_user_created_idx").on(t.userId, t.createdAt),
    uniqueIndex("notifications_user_dedup_idx").on(t.userId, t.dedupKey),
  ],
);

/**
 * Price and market cap at fixed offsets after an alert or a scan.
 * One row per (mint, source event, offset). Used by the calibration job (section 6.4).
 */
export const alertOutcomes = pgTable(
  "alert_outcomes",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    mint: text("mint")
      .notNull()
      .references(() => tokens.mint, { onDelete: "cascade" }),
    riskReportId: integer("risk_report_id"),
    baseTs: ts("base_ts").notNull(),
    basePrice: money("base_price"),
    baseMarketCap: money("base_market_cap"),
    offsetMinutes: integer("offset_minutes").notNull(),
    price: money("price"),
    marketCap: money("market_cap"),
    recordedAt: ts("recorded_at").notNull().defaultNow(),
  },
  (t) => [index("alert_outcomes_mint_base_idx").on(t.mint, t.baseTs, t.offsetMinutes)],
);

export const regimeSnapshots = pgTable("regime_snapshots", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  ts: ts("ts").notNull().defaultNow(),
  btcTrend: text("btc_trend"),
  ethTrend: text("eth_trend"),
  solTrend: text("sol_trend"),
  memecoinVolumeIndex: numeric("memecoin_volume_index", { precision: 18, scale: 6 }),
  avgPeakMcap: money("avg_peak_mcap"),
  regime: regimeEnum("regime").notNull(),
});
