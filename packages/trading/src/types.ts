import type { Regime, ScoreBand } from "@meme-guard/shared-types";

export type LimitRule =
  | "max_pct_per_coin"
  | "max_open_positions"
  | "max_pct_low_mcap"
  | "high_risk_max_pct"
  | "daily_loss_lock"
  | "cooldown_after_loss"
  | "thesis_required"
  | "sell_reason_required"
  | "fomo_confirm_required"
  | "insufficient_balance"
  | "price_impact"
  | "report_stale"
  | "not_tradable";

export interface LimitViolation {
  rule: LimitRule;
  value: number | string | boolean | null;
  threshold: number | string | boolean | null;
  result: "pass" | "fail";
  detail?: string;
}

export interface OpenPositionState {
  mint: string;
  remainingCostSol: number;
}

export interface LimitState {
  paperBalanceSol: number;
  /** Cash plus mark-to-market of open paper positions. */
  equitySol: number;
  /** Equity at 00:00 UTC (or first activity of the day). */
  dayStartEquitySol: number;
  openPositions: OpenPositionState[];
  lastLosingTradeAt: Date | null;
  now: Date;
  regime?: Regime | null;
}

export interface LimitRequest {
  mint: string;
  sizeSol: number;
  marketCapUsd: number | null;
  scoreBand: ScoreBand | null;
  thesis?: string;
  sellReason?: string;
  priceChange1hPct?: number | null;
  fomoConfirmed?: boolean;
}

export interface LimitCheck {
  ok: boolean;
  violations: LimitViolation[];
  applied: {
    maxPct: number;
    maxSizeSol: number;
    maxOpenPositions: number;
    dailyLossLocked: boolean;
    cooldownUntil: string | null;
  };
}

export interface PaperBuyFill {
  side: "buy";
  solSpent: number;
  tokensReceived: number;
  fillPriceSol: number;
  priceImpactPct: number | null;
}

export interface PaperSellFill {
  side: "sell";
  solReceived: number;
  tokensSold: number;
  fillPriceSol: number;
  priceImpactPct: number | null;
  remainingCostSol: number;
  realizedPnlSol: number;
}

export interface PositionPnl {
  remainingTokens: number;
  remainingCostSol: number;
  markValueSol: number;
  unrealizedPnlSol: number;
  unrealizedPct: number | null;
  realizedPnlSol: number;
}
