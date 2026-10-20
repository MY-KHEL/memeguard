import { describe, expect, it } from "vitest";
import { fillBuy, fillSell } from "./paper";
import { dailyLossPct, inventoryFromFills, markPosition } from "./pnl";

describe("paper PnL", () => {
  it("matches a manual buy-then-sell calculation", () => {
    // Buy 2 SOL for 1_000 tokens (0.002 SOL each). Sell 400 tokens for 1.2 SOL.
    // Cost sold = 2 * 0.4 = 0.8. Realized = 1.2 - 0.8 = 0.4.
    // Remaining 600 tokens, cost 1.2. Mark 0.003 SOL → value 1.8, unrealized 0.6.
    const buy = fillBuy({ solIn: 2, tokensOut: 1000, priceImpactPct: 0 });
    const sell = fillSell({ tokensIn: 400, solOut: 1.2, priceImpactPct: 0 }, buy.tokensReceived, buy.solSpent);
    const inv = inventoryFromFills([
      { side: "buy", sol: buy.solSpent, tokens: buy.tokensReceived },
      { side: "sell", sol: sell.solReceived, tokens: sell.tokensSold },
    ]);
    expect(inv.remainingTokens).toBe(600);
    expect(inv.remainingCostSol).toBeCloseTo(1.2);
    expect(inv.realizedPnlSol).toBeCloseTo(0.4);
    expect(sell.realizedPnlSol).toBeCloseTo(inv.realizedPnlSol);

    const mark = markPosition(inv.remainingTokens, inv.remainingCostSol, 0.003, inv.realizedPnlSol);
    expect(mark.markValueSol).toBeCloseTo(1.8);
    expect(mark.unrealizedPnlSol).toBeCloseTo(0.6);
    expect(mark.unrealizedPct).toBeCloseTo(50);
    expect(mark.realizedPnlSol).toBeCloseTo(0.4);
  });

  it("closes to zero remaining and the full realized PnL", () => {
    const buy = fillBuy({ solIn: 5, tokensOut: 250, priceImpactPct: null });
    const sell = fillSell({ tokensIn: 250, solOut: 4, priceImpactPct: null }, buy.tokensReceived, buy.solSpent);
    expect(sell.remainingCostSol).toBeCloseTo(0);
    expect(sell.realizedPnlSol).toBeCloseTo(-1);
    const inv = inventoryFromFills([
      { side: "buy", sol: 5, tokens: 250 },
      { side: "sell", sol: 4, tokens: 250 },
    ]);
    expect(inv.remainingTokens).toBe(0);
    expect(inv.realizedPnlSol).toBeCloseTo(-1);
  });

  it("computes daily loss percent from day-start equity", () => {
    expect(dailyLossPct(50, 45)).toBeCloseTo(10);
    expect(dailyLossPct(50, 50)).toBe(0);
    expect(dailyLossPct(0, 10)).toBe(0);
  });
});
