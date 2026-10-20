import { describe, expect, it } from "vitest";
import { creatorRugCount, isLiquidityCollapsed, nextPeak } from "./creators";

describe("creator history", () => {
  it("detects a 90% liquidity collapse and not a 89% one", () => {
    expect(isLiquidityCollapsed(1000, 100)).toBe(true);
    expect(isLiquidityCollapsed(1000, 110)).toBe(false);
    expect(isLiquidityCollapsed(null, 10)).toBe(false);
  });

  it("tracks the peak without decreasing it", () => {
    expect(nextPeak(null, 10)).toBe(10);
    expect(nextPeak(20, 15)).toBe(20);
    expect(nextPeak(20, 25)).toBe(25);
  });

  it("counts rugs from RugCheck and from our own collapse signal", () => {
    expect(creatorRugCount({ recordedRugs: 0, ruggedFlag: false, collapsedHere: false })).toBe(0);
    expect(creatorRugCount({ recordedRugs: 0, ruggedFlag: true, collapsedHere: false })).toBe(1);
    expect(creatorRugCount({ recordedRugs: 2, ruggedFlag: false, collapsedHere: true })).toBe(3);
  });
});
