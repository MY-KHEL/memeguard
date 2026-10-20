import { z } from "zod";
import rawConfig from "../trading-config.json" with { type: "json" };

const bounded = z.object({
  default: z.number(),
  min: z.number(),
  max: z.number(),
});

export const tradingConfigSchema = z.object({
  config_version: z.string().min(1),
  notes: z.string().optional(),
  paper: z.object({
    starting_balance_sol: z.number().positive(),
  }),
  limits: z.object({
    max_pct_per_coin: bounded,
    max_open_positions: bounded,
    low_mcap_usd: z.number().positive(),
    max_pct_low_mcap: bounded,
    daily_loss_pct: bounded,
    cooldown_after_loss_minutes: bounded,
    high_risk_max_pct: bounded,
  }),
  discipline: z.object({
    fomo_1h_change_pct: z.number().positive(),
    recheck_unrealized_pct: z.number().positive(),
    min_thesis_chars: z.number().int().positive(),
    min_sell_reason_chars: z.number().int().positive(),
    max_report_age_minutes: z.number().positive(),
  }),
  exit_plan: z.object({
    default_stop_pct: z.number().positive(),
    default_ladder: z.array(z.object({ multiple: z.number().positive(), sell_pct: z.number().positive() })),
  }),
  quote: z.object({
    slippage_bps: z.number().int().positive(),
    max_price_impact_pct: z.number().positive(),
  }),
  live: z.object({
    interval_ms: z.number().int().positive(),
    max_watched_mints: z.number().int().positive(),
  }),
  regime: z.object({
    cold_size_multiplier: z.number().positive().max(1),
  }),
});

export type TradingConfig = z.infer<typeof tradingConfigSchema>;

export const tradingConfig: TradingConfig = tradingConfigSchema.parse(rawConfig);
export const TRADING_CONFIG_VERSION = tradingConfig.config_version;

export type LimitOverrides = {
  maxPctPerCoin?: number;
  maxOpenPositions?: number;
  maxPctLowMcap?: number;
  dailyLossPct?: number;
  cooldownAfterLossMinutes?: number;
  highRiskMaxPct?: number;
};

export interface ResolvedLimits {
  maxPctPerCoin: number;
  maxOpenPositions: number;
  lowMcapUsd: number;
  maxPctLowMcap: number;
  dailyLossPct: number;
  cooldownAfterLossMinutes: number;
  highRiskMaxPct: number;
}

function clampBound(value: number | undefined, bound: { default: number; min: number; max: number }): number {
  const n = value === undefined || !Number.isFinite(value) ? bound.default : value;
  return Math.min(bound.max, Math.max(bound.min, n));
}

/** User overrides stay inside the safe bounds from trading-config.json. */
export function resolveLimits(overrides: LimitOverrides | undefined, config: TradingConfig = tradingConfig): ResolvedLimits {
  const l = config.limits;
  return {
    maxPctPerCoin: clampBound(overrides?.maxPctPerCoin, l.max_pct_per_coin),
    maxOpenPositions: Math.round(clampBound(overrides?.maxOpenPositions, l.max_open_positions)),
    lowMcapUsd: l.low_mcap_usd,
    maxPctLowMcap: clampBound(overrides?.maxPctLowMcap, l.max_pct_low_mcap),
    dailyLossPct: clampBound(overrides?.dailyLossPct, l.daily_loss_pct),
    cooldownAfterLossMinutes: clampBound(overrides?.cooldownAfterLossMinutes, l.cooldown_after_loss_minutes),
    highRiskMaxPct: clampBound(overrides?.highRiskMaxPct, l.high_risk_max_pct),
  };
}
