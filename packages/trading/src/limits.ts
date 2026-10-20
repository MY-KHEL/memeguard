import type { Regime } from "@meme-guard/shared-types";
import { tradingConfig, resolveLimits, type LimitOverrides, type ResolvedLimits, type TradingConfig } from "./config";
import type { LimitCheck, LimitRequest, LimitState, LimitViolation } from "./types";

/** COLD regime shrinks size caps. User can still trade inside the reduced bounds. */
export function applyRegimeToLimits(limits: ResolvedLimits, regime: Regime | null | undefined, config: TradingConfig = tradingConfig): ResolvedLimits {
  if (regime !== "COLD") return limits;
  const m = config.regime.cold_size_multiplier;
  return {
    ...limits,
    maxPctPerCoin: limits.maxPctPerCoin * m,
    maxPctLowMcap: limits.maxPctLowMcap * m,
    highRiskMaxPct: limits.highRiskMaxPct * m,
  };
}

function violation(
  rule: LimitViolation["rule"],
  value: LimitViolation["value"],
  threshold: LimitViolation["threshold"],
  result: "pass" | "fail",
  detail?: string,
): LimitViolation {
  return { rule, value, threshold, result, detail };
}

function existingCost(state: LimitState, mint: string): number {
  return state.openPositions.find((p) => p.mint === mint)?.remainingCostSol ?? 0;
}

/** Tightest size cap that applies: per-coin, low-mcap, and HIGH-risk. */
export function effectiveMaxPct(request: LimitRequest, limits: ResolvedLimits): { maxPct: number; rules: LimitViolation[] } {
  let maxPct = limits.maxPctPerCoin;
  const rules: LimitViolation[] = [];

  const perCoin = request.sizeSol; // placeholder so callers can still see the bound
  void perCoin;
  rules.push(violation("max_pct_per_coin", maxPct, limits.maxPctPerCoin, "pass"));

  if (request.marketCapUsd !== null && request.marketCapUsd < limits.lowMcapUsd) {
    const next = Math.min(maxPct, limits.maxPctLowMcap);
    rules.push(
      violation(
        "max_pct_low_mcap",
        request.marketCapUsd,
        limits.lowMcapUsd,
        "pass",
        `mcap below ${limits.lowMcapUsd}; cap ${limits.maxPctLowMcap}%`,
      ),
    );
    maxPct = next;
  }

  if (request.scoreBand === "HIGH") {
    maxPct = Math.min(maxPct, limits.highRiskMaxPct);
    rules.push(violation("high_risk_max_pct", request.scoreBand, limits.highRiskMaxPct, "pass"));
  }

  return { maxPct, rules };
}

export function checkLimits(
  state: LimitState,
  request: LimitRequest,
  overrides?: LimitOverrides,
  config: TradingConfig = tradingConfig,
): LimitCheck {
  const limits = applyRegimeToLimits(resolveLimits(overrides, config), state.regime, config);
  const violations: LimitViolation[] = [];
  const equity = state.equitySol > 0 ? state.equitySol : 0;
  const { maxPct } = effectiveMaxPct(request, limits);
  const maxSizeSol = equity * (maxPct / 100);
  const proposedCost = existingCost(state, request.mint) + request.sizeSol;
  const proposedPct = equity > 0 ? (proposedCost / equity) * 100 : Infinity;

  if (!(request.sizeSol > 0) || request.sizeSol > state.paperBalanceSol) {
    violations.push(
      violation("insufficient_balance", request.sizeSol, state.paperBalanceSol, "fail", "size must be positive and within paper cash"),
    );
  }

  const sizeResult = proposedPct <= maxPct || (equity === 0 && request.sizeSol === 0) ? "pass" : "fail";
  if (request.marketCapUsd !== null && request.marketCapUsd < limits.lowMcapUsd && proposedPct > limits.maxPctLowMcap) {
    violations.push(violation("max_pct_low_mcap", proposedPct, limits.maxPctLowMcap, "fail"));
  } else if (request.scoreBand === "HIGH" && proposedPct > limits.highRiskMaxPct) {
    violations.push(violation("high_risk_max_pct", proposedPct, limits.highRiskMaxPct, "fail"));
  } else if (proposedPct > limits.maxPctPerCoin) {
    violations.push(violation("max_pct_per_coin", proposedPct, limits.maxPctPerCoin, "fail"));
  } else {
    violations.push(violation("max_pct_per_coin", proposedPct, maxPct, "pass"));
  }

  const distinctOpen = new Set(state.openPositions.map((p) => p.mint));
  const wouldAdd = !distinctOpen.has(request.mint);
  const openAfter = distinctOpen.size + (wouldAdd ? 1 : 0);
  violations.push(
    violation(
      "max_open_positions",
      openAfter,
      limits.maxOpenPositions,
      openAfter <= limits.maxOpenPositions ? "pass" : "fail",
    ),
  );

  const dayStart = state.dayStartEquitySol > 0 ? state.dayStartEquitySol : state.equitySol;
  const lossPct = dayStart > 0 ? ((dayStart - state.equitySol) / dayStart) * 100 : 0;
  const dailyLossLocked = lossPct >= limits.dailyLossPct;
  violations.push(violation("daily_loss_lock", lossPct, limits.dailyLossPct, dailyLossLocked ? "fail" : "pass"));

  let cooldownUntil: string | null = null;
  if (state.lastLosingTradeAt) {
    const until = new Date(state.lastLosingTradeAt.getTime() + limits.cooldownAfterLossMinutes * 60_000);
    cooldownUntil = until.toISOString();
    const inCooldown = state.now.getTime() < until.getTime();
    violations.push(violation("cooldown_after_loss", state.now.toISOString(), until.toISOString(), inCooldown ? "fail" : "pass"));
  } else {
    violations.push(violation("cooldown_after_loss", null, limits.cooldownAfterLossMinutes, "pass"));
  }

  const minThesis = config.discipline.min_thesis_chars;
  const thesis = request.thesis?.trim() ?? "";
  if (thesis.length < minThesis) {
    violations.push(violation("thesis_required", thesis.length, minThesis, "fail"));
  } else {
    violations.push(violation("thesis_required", thesis.length, minThesis, "pass"));
  }

  const minSell = config.discipline.min_sell_reason_chars;
  const sellReason = request.sellReason?.trim() ?? "";
  if (sellReason.length < minSell) {
    violations.push(violation("sell_reason_required", sellReason.length, minSell, "fail"));
  } else {
    violations.push(violation("sell_reason_required", sellReason.length, minSell, "pass"));
  }

  const fomoPct = request.priceChange1hPct;
  if (fomoPct !== null && fomoPct !== undefined && fomoPct >= config.discipline.fomo_1h_change_pct && !request.fomoConfirmed) {
    violations.push(violation("fomo_confirm_required", fomoPct, config.discipline.fomo_1h_change_pct, "fail"));
  } else if (fomoPct !== null && fomoPct !== undefined && fomoPct >= config.discipline.fomo_1h_change_pct) {
    violations.push(violation("fomo_confirm_required", fomoPct, config.discipline.fomo_1h_change_pct, "pass"));
  }

  return {
    ok: violations.every((v) => v.result === "pass"),
    violations,
    applied: {
      maxPct,
      maxSizeSol,
      maxOpenPositions: limits.maxOpenPositions,
      dailyLossLocked,
      cooldownUntil,
    },
  };
}

export { resolveLimits };
export type { LimitOverrides, ResolvedLimits };
