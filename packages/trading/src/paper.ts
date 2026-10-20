import type { PaperBuyFill, PaperSellFill } from "./types";

const EPS = 1e-12;

export interface BuyQuote {
  /** SOL spent (input), already in SOL not lamports. */
  solIn: number;
  /** Tokens received from the quote. */
  tokensOut: number;
  priceImpactPct: number | null;
}

export interface SellQuote {
  tokensIn: number;
  solOut: number;
  priceImpactPct: number | null;
}

/** Simulated fill at the live quote, including impact already baked into out-amount. */
export function fillBuy(quote: BuyQuote): PaperBuyFill {
  if (!(quote.solIn > 0) || !(quote.tokensOut > 0)) {
    throw new Error("paper buy quote missing solIn or tokensOut");
  }
  return {
    side: "buy",
    solSpent: quote.solIn,
    tokensReceived: quote.tokensOut,
    fillPriceSol: quote.solIn / quote.tokensOut,
    priceImpactPct: quote.priceImpactPct,
  };
}

export function fillSell(quote: SellQuote, remainingTokens: number, remainingCostSol: number): PaperSellFill {
  if (!(quote.tokensIn > 0) || !(quote.solOut >= 0)) {
    throw new Error("paper sell quote missing tokensIn or solOut");
  }
  if (quote.tokensIn - remainingTokens > EPS) {
    throw new Error("sell amount exceeds remaining tokens");
  }
  const fraction = remainingTokens <= EPS ? 1 : quote.tokensIn / remainingTokens;
  const costSold = remainingCostSol * fraction;
  return {
    side: "sell",
    solReceived: quote.solOut,
    tokensSold: quote.tokensIn,
    fillPriceSol: quote.solOut / quote.tokensIn,
    priceImpactPct: quote.priceImpactPct,
    remainingCostSol: Math.max(0, remainingCostSol - costSold),
    realizedPnlSol: quote.solOut - costSold,
  };
}

export function applyAddOnBuy(
  remainingTokens: number,
  remainingCostSol: number,
  fill: PaperBuyFill,
): { remainingTokens: number; remainingCostSol: number; averagePriceSol: number } {
  const tokens = remainingTokens + fill.tokensReceived;
  const cost = remainingCostSol + fill.solSpent;
  return {
    remainingTokens: tokens,
    remainingCostSol: cost,
    averagePriceSol: tokens > 0 ? cost / tokens : 0,
  };
}
