import type { PositionPnl } from "./types";

export interface FillLeg {
  side: "buy" | "sell";
  sol: number;
  tokens: number;
}

/**
 * Remaining inventory and realized PnL from a sequence of fills.
 * Buys add cost and tokens; sells reduce both pro-rata and realize the difference.
 */
export function inventoryFromFills(fills: FillLeg[]): { remainingTokens: number; remainingCostSol: number; realizedPnlSol: number } {
  let remainingTokens = 0;
  let remainingCostSol = 0;
  let realizedPnlSol = 0;
  for (const fill of fills) {
    if (fill.side === "buy") {
      remainingTokens += fill.tokens;
      remainingCostSol += fill.sol;
      continue;
    }
    if (remainingTokens <= 0) continue;
    const fraction = Math.min(1, fill.tokens / remainingTokens);
    const costSold = remainingCostSol * fraction;
    remainingTokens -= fill.tokens;
    remainingCostSol -= costSold;
    realizedPnlSol += fill.sol - costSold;
  }
  return {
    remainingTokens: Math.max(0, remainingTokens),
    remainingCostSol: Math.max(0, remainingCostSol),
    realizedPnlSol,
  };
}

/** Mark-to-market in SOL. markPriceSol is SOL per token (same unit as fill price). */
export function markPosition(
  remainingTokens: number,
  remainingCostSol: number,
  markPriceSol: number,
  realizedPnlSol = 0,
): PositionPnl {
  const markValueSol = remainingTokens * markPriceSol;
  const unrealizedPnlSol = markValueSol - remainingCostSol;
  return {
    remainingTokens,
    remainingCostSol,
    markValueSol,
    unrealizedPnlSol,
    unrealizedPct: remainingCostSol > 0 ? (unrealizedPnlSol / remainingCostSol) * 100 : null,
    realizedPnlSol,
  };
}

export function dailyLossPct(dayStartEquitySol: number, equitySol: number): number {
  if (!(dayStartEquitySol > 0)) return 0;
  return ((dayStartEquitySol - equitySol) / dayStartEquitySol) * 100;
}
