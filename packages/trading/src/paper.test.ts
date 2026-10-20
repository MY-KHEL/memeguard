import { describe, expect, it } from "vitest";
import { applyAddOnBuy, fillBuy, fillSell } from "./paper";

describe("paper fills", () => {
  it("uses the quoted out-amount so impact is in the fill price", () => {
    const fill = fillBuy({ solIn: 1, tokensOut: 800, priceImpactPct: 2.5 });
    expect(fill.solSpent).toBe(1);
    expect(fill.tokensReceived).toBe(800);
    expect(fill.fillPriceSol).toBe(1 / 800);
    expect(fill.priceImpactPct).toBe(2.5);
  });

  it("realizes sell PnL against remaining cost", () => {
    const buy = fillBuy({ solIn: 2, tokensOut: 1000, priceImpactPct: 0 });
    const sell = fillSell({ tokensIn: 400, solOut: 1.2, priceImpactPct: 1 }, buy.tokensReceived, buy.solSpent);
    expect(sell.remainingCostSol).toBeCloseTo(1.2);
    expect(sell.realizedPnlSol).toBeCloseTo(0.4);
  });

  it("averages an add-on buy", () => {
    const first = fillBuy({ solIn: 2, tokensOut: 1000, priceImpactPct: null });
    const second = fillBuy({ solIn: 1, tokensOut: 400, priceImpactPct: null });
    const pos = applyAddOnBuy(first.tokensReceived, first.solSpent, second);
    expect(pos.remainingTokens).toBe(1400);
    expect(pos.remainingCostSol).toBe(3);
    expect(pos.averagePriceSol).toBeCloseTo(3 / 1400);
  });

  it("refuses a sell larger than remaining tokens", () => {
    expect(() => fillSell({ tokensIn: 2, solOut: 1, priceImpactPct: null }, 1, 1)).toThrow(/exceeds/);
  });
});
