import { z } from "zod";
import rawConfig from "../risk-config.json" with { type: "json" };

const thresholdSchema = z.object({ value: z.number(), source: z.string() });

export const riskConfigSchema = z.object({
  config_version: z.string().min(1),
  notes: z.string().optional(),
  hard_filters: z.object({
    mint_authority_revoked: z.object({ required: z.literal(true), source: z.string() }),
    freeze_authority_revoked: z.object({ required: z.literal(true), source: z.string() }),
    liquidity_locked_or_burned_pct_min: z.object({
      value: z.number().min(0).max(100),
      exempt_on_launchpad_bonding_curve: z.boolean(),
      source: z.string(),
    }),
    sell_simulation: z.object({
      required: z.literal(true),
      max_price_impact_pct: z.number().positive(),
      test_amount_usd: z.number().positive(),
      source: z.string(),
    }),
    largest_non_lp_holder_pct_max: thresholdSchema,
    fresh_wallets_in_top_20_max: thresholdSchema,
    fresh_wallet_max_age_days: thresholdSchema,
    same_source_funded_top_holders_max: thresholdSchema,
    bundled_cluster_supply_pct_max: thresholdSchema,
    creator_prior_rugs_max: thresholdSchema,
    honeypot_pattern: z.object({
      enabled: z.boolean(),
      description: z.string(),
      source: z.string(),
      min_candles: z.number().int().positive(),
      min_up_candle_ratio: z.number().min(0).max(1),
      max_volume_to_mcap_ratio: z.number().nonnegative(),
      max_holders: z.number().int().positive(),
    }),
    min_liquidity_sol: thresholdSchema,
    volume_vs_mcap: z.object({
      young_hours: z.number().positive(),
      young_min_ratio: z.number().nonnegative(),
      mature_min_ratio: z.number().nonnegative(),
      source: z.string(),
    }),
    recent_activity: z.object({
      min_volume_5m_usd: z.number().nonnegative(),
      min_volume_1h_usd: z.number().nonnegative(),
      source: z.string(),
    }),
  }),
  scoring: z.object({
    weights: z.record(z.string(), z.number().nonnegative()),
    disabled_factors: z.array(z.string()),
    redistribute_disabled_weights: z.boolean(),
    bands: z.object({
      lower_risk_min: z.number().min(0).max(100),
      medium_min: z.number().min(0).max(100),
    }),
    factors: z.object({
      liquidity_depth_vs_mcap: z.object({
        full_score_ratio: z.number().positive(),
        zero_score_ratio: z.number().nonnegative(),
      }),
      volume_vs_mcap: z.object({
        young_hours: z.number().positive(),
        young_min_ratio: z.number().nonnegative(),
        mature_min_ratio: z.number().nonnegative(),
      }),
      holder_distribution: z.object({
        top5_pct_full: z.number(),
        top5_pct_zero: z.number(),
        top10_pct_full: z.number(),
        top10_pct_zero: z.number(),
      }),
      dev_behavior: z.object({
        large_buy_mcap_pct: z.number().positive(),
        sell_penalty: z.number().min(0).max(1),
      }),
      chart_authenticity: z.object({
        identical_body_tolerance_pct: z.number().nonnegative(),
        identical_share_warn: z.number().min(0).max(1),
        huge_candle_share_warn: z.number().min(0).max(1),
        staircase_min_steps: z.number().int().positive(),
      }),
      narrative_crowding: z.object({
        window_hours: z.number().positive(),
        full_score_peers: z.number().nonnegative(),
        zero_score_peers: z.number().positive(),
      }),
    }),
  }),
  regime: z.object({
    lookback_days: z.number().int().positive(),
    hhhl_min_pairs: z.number().int().positive(),
    majors_up_for_hot: z.number().int().positive(),
    majors_down_for_cold: z.number().int().positive(),
    volume_hot_ratio: z.number().positive(),
    volume_cold_ratio: z.number().positive(),
    peak_mcap_hot_usd: z.number().positive(),
    peak_mcap_cold_usd: z.number().positive(),
  }),
  calibration: z.object({
    offsets_minutes: z.array(z.number().int().positive()).min(1),
    rugged_drop_pct: z.number().positive().max(100),
  }),
});

export type RiskConfig = z.infer<typeof riskConfigSchema>;

export const riskConfig: RiskConfig = riskConfigSchema.parse(rawConfig);
export const CONFIG_VERSION = riskConfig.config_version;

export const SCORE_BANDS = ["LOWER_RISK", "MEDIUM", "HIGH"] as const;
export type ScoreBand = (typeof SCORE_BANDS)[number];
