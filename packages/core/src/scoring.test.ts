import { describe, expect, it } from "vitest";
import { analyseChart } from "./chart";
import { evaluateRisk } from "./evaluate";
import { combineScore, effectiveWeights, lerpScore, scoreBand, scoreFactors, scoreLiquidityDepth, scoreNarrativeCrowding } from "./scoring";
import { passingInputs, riskConfig, upOnlyCandles, variedCandles } from "./test-fixtures";
import { ok, unavailable } from "./types";

describe("lerpScore", () => {
  it("is 1 at the full end, 0 at the zero end, and 0.5 halfway", () => {
    expect(lerpScore(20, 20, 0)).toBe(1);
    expect(lerpScore(0, 20, 0)).toBe(0);
    expect(lerpScore(10, 20, 0)).toBe(0.5);
    expect(lerpScore(15, 10, 50)).toBeCloseTo(0.875);
  });
});

describe("effectiveWeights", () => {
  it("redistributes disabled weights across the remaining factors", () => {
    const w = effectiveWeights(riskConfig);
    expect(w.social_legitimacy).toBe(0);
    expect(w.fees_paid_vs_mcap).toBe(0);
    const active = Object.entries(w).filter(([, n]) => n > 0);
    const sum = active.reduce((s, [, n]) => s + n, 0);
    expect(sum).toBe(100);
    expect(w.liquidity_depth_vs_mcap).toBeGreaterThan(20);
  });
});

describe("scoreLiquidityDepth", () => {
  it("scores 1 at the full ratio and 0 at the zero ratio", () => {
    const p = riskConfig.scoring.factors.liquidity_depth_vs_mcap;
    const full = scoreLiquidityDepth(passingInputs({ liquidityUsd: ok(p.full_score_ratio * 100), marketCapUsd: ok(100) }), riskConfig, 20);
    const zero = scoreLiquidityDepth(passingInputs({ liquidityUsd: ok(p.zero_score_ratio * 100), marketCapUsd: ok(100) }), riskConfig, 20);
    expect(full.score).toBe(1);
    expect(zero.score).toBe(0);
  });
  it("is unverified without liquidity", () => {
    expect(scoreLiquidityDepth(passingInputs({ liquidityUsd: unavailable("dexscreener") }), riskConfig, 20).unverified).toBe(true);
  });
});

describe("analyseChart", () => {
  it("scores varied candles higher than identical staircases", () => {
    const authentic = analyseChart(variedCandles(24), riskConfig);
    const fake = analyseChart(upOnlyCandles(24), riskConfig);
    expect(authentic.score).toBeGreaterThan(fake.score);
    expect(fake.staircaseSteps).toBeGreaterThanOrEqual(riskConfig.scoring.factors.chart_authenticity.staircase_min_steps);
  });
});

describe("scoreBand", () => {
  it("uses config boundaries inclusive of the lower edge", () => {
    expect(scoreBand(75, riskConfig)).toBe("LOWER_RISK");
    expect(scoreBand(74, riskConfig)).toBe("MEDIUM");
    expect(scoreBand(50, riskConfig)).toBe("MEDIUM");
    expect(scoreBand(49, riskConfig)).toBe("HIGH");
  });
});

describe("evaluateRisk", () => {
  it("PASS with a numeric score when every filter and factor is known", () => {
    const ev = evaluateRisk(passingInputs(), riskConfig, new Date("2026-10-03T00:00:00Z"));
    expect(ev.verdict).toBe("PASS");
    expect(ev.score).toBeTypeOf("number");
    expect(ev.band).toBeTruthy();
    expect(ev.configVersion).toBe(riskConfig.config_version);
    expect(ev.reasons).toHaveLength(13);
  });
  it("BLOCKED with no score when a hard filter fails", () => {
    const ev = evaluateRisk(passingInputs({ mintAuthority: ok("LIVE") }), riskConfig);
    expect(ev.verdict).toBe("BLOCKED");
    expect(ev.score).toBeNull();
    expect(ev.factors).toEqual([]);
  });
  it("UNVERIFIED when a hard-filter source is down", () => {
    const ev = evaluateRisk(passingInputs({ mintAuthority: unavailable("helius") }), riskConfig);
    expect(ev.verdict).toBe("UNVERIFIED");
    expect(ev.unavailableSources).toContain("helius");
  });
  it("UNVERIFIED when scoring data is missing after filters pass", () => {
    const ev = evaluateRisk(passingInputs({ top5Pct: unavailable("rugcheck") }), riskConfig);
    expect(ev.verdict).toBe("UNVERIFIED");
    expect(ev.factors.some((f) => f.factor === "holder_distribution" && f.unverified)).toBe(true);
  });
  it("does not invent a score from disabled factors alone", () => {
    const factors = scoreFactors(passingInputs({ top5Pct: unavailable("x") }), riskConfig);
    expect(combineScore(factors).unverified).toBe(true);
  });
});

describe("scoreNarrativeCrowding", () => {
  const applied = 10;
  it("scores 1 when no other coin shares the name", () => {
    const factor = scoreNarrativeCrowding(passingInputs({ sameNamePeers: ok(0) }), riskConfig, applied);
    expect(factor.score).toBe(1);
    expect(factor.detail).toMatch(/no other coin/);
  });
  it("scores 0 at the crowded peer count", () => {
    const factor = scoreNarrativeCrowding(passingInputs({ sameNamePeers: ok(5) }), riskConfig, applied);
    expect(factor.score).toBe(0);
    expect(factor.detail).toMatch(/5 other coins/);
  });
  it("scores halfway between unique and crowded", () => {
    const factor = scoreNarrativeCrowding(passingInputs({ sameNamePeers: ok(2.5) }), riskConfig, applied);
    expect(factor.score).toBeCloseTo(0.5);
  });
  it("stays unverified when the name and symbol are unknown", () => {
    const factor = scoreNarrativeCrowding(passingInputs({ sameNamePeers: unavailable("tokens") }), riskConfig, applied);
    expect(factor.unverified).toBe(true);
    expect(factor.score).toBeNull();
  });
});
