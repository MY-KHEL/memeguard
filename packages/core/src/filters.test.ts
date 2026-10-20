import { describe, expect, it } from "vitest";
import {
  bundledCluster,
  creatorPriorRugs,
  freezeAuthorityRevoked,
  freshWallets,
  hardFilterVerdict,
  honeypotPattern,
  largestNonLpHolder,
  liquidityLockedOrBurned,
  minLiquidity,
  mintAuthorityRevoked,
  recentActivity,
  runHardFilters,
  sameSourceFunded,
  sellSimulation,
  volumeVsMcap,
} from "./filters";
import { passingInputs, riskConfig, upOnlyCandles } from "./test-fixtures";
import { ok, unavailable } from "./types";

describe("mint_authority_revoked", () => {
  it("passes when revoked (null) and fails when live", () => {
    expect(mintAuthorityRevoked(passingInputs(), riskConfig).result).toBe("pass");
    expect(mintAuthorityRevoked(passingInputs({ mintAuthority: ok("AUTH") }), riskConfig).result).toBe("fail");
  });
  it("is unverified when the source is down", () => {
    const r = mintAuthorityRevoked(passingInputs({ mintAuthority: unavailable("helius") }), riskConfig);
    expect(r.result).toBe("unverified");
    expect(r.source).toBe("helius");
  });
});

describe("freeze_authority_revoked", () => {
  it("passes at revoked, fails when live, unverified when missing", () => {
    expect(freezeAuthorityRevoked(passingInputs(), riskConfig).result).toBe("pass");
    expect(freezeAuthorityRevoked(passingInputs({ freezeAuthority: ok("FRZ") }), riskConfig).result).toBe("fail");
    expect(freezeAuthorityRevoked(passingInputs({ freezeAuthority: unavailable("rugcheck") }), riskConfig).result).toBe("unverified");
  });
});

describe("liquidity_locked_or_burned", () => {
  const threshold = riskConfig.hard_filters.liquidity_locked_or_burned_pct_min.value;
  it("passes at and above the threshold, fails just below", () => {
    expect(liquidityLockedOrBurned(passingInputs({ lpLockedPct: ok(threshold) }), riskConfig).result).toBe("pass");
    expect(liquidityLockedOrBurned(passingInputs({ lpLockedPct: ok(threshold + 0.1) }), riskConfig).result).toBe("pass");
    expect(liquidityLockedOrBurned(passingInputs({ lpLockedPct: ok(threshold - 0.1) }), riskConfig).result).toBe("fail");
  });
  it("exempts bonding-curve tokens even with 0 lock", () => {
    const r = liquidityLockedOrBurned(passingInputs({ lpLockedPct: ok(0), onBondingCurve: ok(true) }), riskConfig);
    expect(r.result).toBe("pass");
    expect(r.detail).toMatch(/exempt/i);
  });
  it("is unverified when lock percent is unknown and not on a curve", () => {
    expect(liquidityLockedOrBurned(passingInputs({ lpLockedPct: unavailable("rugcheck") }), riskConfig).result).toBe("unverified");
    expect(liquidityLockedOrBurned(passingInputs({ lpLockedPct: ok(null) }), riskConfig).result).toBe("unverified");
  });
});

describe("sell_simulation", () => {
  const max = riskConfig.hard_filters.sell_simulation.max_price_impact_pct;
  it("passes at and below max impact, fails above and when unquoted", () => {
    expect(sellSimulation(passingInputs({ sellSimulation: ok({ quoted: true, priceImpactPct: max }) }), riskConfig).result).toBe("pass");
    expect(sellSimulation(passingInputs({ sellSimulation: ok({ quoted: true, priceImpactPct: max - 0.01 }) }), riskConfig).result).toBe("pass");
    expect(sellSimulation(passingInputs({ sellSimulation: ok({ quoted: true, priceImpactPct: max + 0.01 }) }), riskConfig).result).toBe("fail");
    expect(sellSimulation(passingInputs({ sellSimulation: ok({ quoted: false, priceImpactPct: null, reason: "no_route" }) }), riskConfig).result).toBe("fail");
  });
  it("is unverified on provider outage, not a fail", () => {
    expect(sellSimulation(passingInputs({ sellSimulation: unavailable("jupiter", "timeout") }), riskConfig).result).toBe("unverified");
  });
});

describe("largest_non_lp_holder", () => {
  const max = riskConfig.hard_filters.largest_non_lp_holder_pct_max.value;
  it("passes at and below, fails just above", () => {
    expect(largestNonLpHolder(passingInputs({ largestNonLpHolderPct: ok(max) }), riskConfig).result).toBe("pass");
    expect(largestNonLpHolder(passingInputs({ largestNonLpHolderPct: ok(max - 0.01) }), riskConfig).result).toBe("pass");
    expect(largestNonLpHolder(passingInputs({ largestNonLpHolderPct: ok(max + 0.01) }), riskConfig).result).toBe("fail");
  });
  it("is unverified when missing", () => {
    expect(largestNonLpHolder(passingInputs({ largestNonLpHolderPct: unavailable("rugcheck") }), riskConfig).result).toBe("unverified");
  });
});

describe("fresh_wallets", () => {
  const max = riskConfig.hard_filters.fresh_wallets_in_top_20_max.value;
  it("passes at and below, fails just above", () => {
    expect(freshWallets(passingInputs({ freshWalletsInTop20: ok(max) }), riskConfig).result).toBe("pass");
    expect(freshWallets(passingInputs({ freshWalletsInTop20: ok(max + 1) }), riskConfig).result).toBe("fail");
    expect(freshWallets(passingInputs({ freshWalletsInTop20: unavailable("helius") }), riskConfig).result).toBe("unverified");
  });
});

describe("same_source_funded", () => {
  const max = riskConfig.hard_filters.same_source_funded_top_holders_max.value;
  it("passes at and below, fails just above", () => {
    expect(sameSourceFunded(passingInputs({ sameSourceFundedTopHolders: ok(max) }), riskConfig).result).toBe("pass");
    expect(sameSourceFunded(passingInputs({ sameSourceFundedTopHolders: ok(max + 1) }), riskConfig).result).toBe("fail");
  });
});

describe("bundled_cluster", () => {
  const max = riskConfig.hard_filters.bundled_cluster_supply_pct_max.value;
  it("passes at and below, fails just above", () => {
    expect(bundledCluster(passingInputs({ bundledClusterSupplyPct: ok(max) }), riskConfig).result).toBe("pass");
    expect(bundledCluster(passingInputs({ bundledClusterSupplyPct: ok(max + 0.1) }), riskConfig).result).toBe("fail");
  });
});

describe("creator_prior_rugs", () => {
  it("fails at 1 rug when the max is 0, passes at 0", () => {
    expect(creatorPriorRugs(passingInputs({ creatorPriorRugs: ok(0) }), riskConfig).result).toBe("pass");
    expect(creatorPriorRugs(passingInputs({ creatorPriorRugs: ok(1) }), riskConfig).result).toBe("fail");
  });
});

describe("honeypot_pattern", () => {
  it("fails only when up-only, low volume and few holders all hold", () => {
    const hp = passingInputs({
      candles: ok(upOnlyCandles(20)),
      volume24hUsd: ok(100),
      marketCapUsd: ok(10_000),
      holders: ok(20),
    });
    expect(honeypotPattern(hp, riskConfig).result).toBe("fail");
    expect(honeypotPattern(passingInputs({ candles: ok(upOnlyCandles(20)), holders: ok(400) }), riskConfig).result).toBe("pass");
  });
  it("is unverified with too few candles or a missing source", () => {
    expect(honeypotPattern(passingInputs({ candles: ok(upOnlyCandles(3)) }), riskConfig).result).toBe("unverified");
    expect(honeypotPattern(passingInputs({ candles: unavailable("geckoterminal") }), riskConfig).result).toBe("unverified");
  });
});

describe("volume_vs_mcap", () => {
  const young = riskConfig.hard_filters.volume_vs_mcap.young_min_ratio;
  const mature = riskConfig.hard_filters.volume_vs_mcap.mature_min_ratio;
  it("passes at the age-scaled floor and fails just below", () => {
    expect(volumeVsMcap(passingInputs({ volume24hUsd: ok(80_000), marketCapUsd: ok(80_000), ageHours: ok(12) }), riskConfig).result).toBe("pass");
    expect(volumeVsMcap(passingInputs({ volume24hUsd: ok(mature * 10_000 - 1), marketCapUsd: ok(10_000), ageHours: ok(12) }), riskConfig).result).toBe("fail");
    expect(volumeVsMcap(passingInputs({ volume24hUsd: ok(young * 10_000), marketCapUsd: ok(10_000), ageHours: ok(1) }), riskConfig).result).toBe("pass");
    expect(volumeVsMcap(passingInputs({ volume24hUsd: ok(4), marketCapUsd: ok(3_400), ageHours: ok(20) }), riskConfig).result).toBe("fail");
  });
  it("is unverified when volume or market cap is missing", () => {
    expect(volumeVsMcap(passingInputs({ volume24hUsd: ok(null) }), riskConfig).result).toBe("unverified");
    expect(volumeVsMcap(passingInputs({ marketCapUsd: unavailable("dexscreener") }), riskConfig).result).toBe("unverified");
  });
});

describe("recent_activity", () => {
  const five = riskConfig.hard_filters.recent_activity.min_volume_5m_usd;
  const hour = riskConfig.hard_filters.recent_activity.min_volume_1h_usd;
  it("passes when either window meets the floor", () => {
    expect(recentActivity(passingInputs({ volume5mUsd: ok(five), volume1hUsd: ok(0) }), riskConfig).result).toBe("pass");
    expect(recentActivity(passingInputs({ volume5mUsd: ok(0), volume1hUsd: ok(hour) }), riskConfig).result).toBe("pass");
  });
  it("fails when both windows are known and quiet", () => {
    expect(recentActivity(passingInputs({ volume5mUsd: ok(five - 1), volume1hUsd: ok(hour - 1) }), riskConfig).result).toBe("fail");
  });
  it("is unverified when both windows are missing", () => {
    expect(recentActivity(passingInputs({ volume5mUsd: ok(null), volume1hUsd: ok(null) }), riskConfig).result).toBe("unverified");
  });
});

describe("min_liquidity", () => {
  const minSol = riskConfig.hard_filters.min_liquidity_sol.value;
  it("passes at and above the SOL equivalent, fails just below", () => {
    const solUsd = 100;
    expect(minLiquidity(passingInputs({ liquidityUsd: ok(minSol * solUsd), solUsd: ok(solUsd) }), riskConfig).result).toBe("pass");
    expect(minLiquidity(passingInputs({ liquidityUsd: ok(minSol * solUsd - 1), solUsd: ok(solUsd) }), riskConfig).result).toBe("fail");
    expect(minLiquidity(passingInputs({ liquidityUsd: unavailable("dexscreener") }), riskConfig).result).toBe("unverified");
  });
});

describe("runHardFilters / verdict", () => {
  it("returns all 13 rules and PASS when every filter passes", () => {
    const reasons = runHardFilters(passingInputs(), riskConfig);
    expect(reasons).toHaveLength(13);
    expect(hardFilterVerdict(reasons)).toBe("PASS");
    expect(reasons.every((r) => r.result === "pass")).toBe(true);
  });
  it("BLOCKED beats UNVERIFIED when both are present", () => {
    const reasons = runHardFilters(
      passingInputs({ mintAuthority: ok("LIVE"), freezeAuthority: unavailable("helius") }),
      riskConfig,
    );
    expect(hardFilterVerdict(reasons)).toBe("BLOCKED");
  });
  it("UNVERIFIED when a source is down and nothing failed", () => {
    const reasons = runHardFilters(passingInputs({ mintAuthority: unavailable("helius") }), riskConfig);
    expect(hardFilterVerdict(reasons)).toBe("UNVERIFIED");
  });
});
