import {
  hardFilterVerdict,
  minLiquidity,
  ok,
  recentActivity,
  riskConfig,
  unavailable,
  volumeVsMcap,
  type RiskConfig,
  type RiskInputs,
  type RuleResult,
} from "@meme-guard/core";

/** Market fields already stored from DexScreener. No paid provider is consulted. */
export interface CheapMarket {
  volume24hUsd: number | null;
  volume5mUsd: number | null;
  volume1hUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  ageHours: number | null;
  solUsd: number | null;
}

export interface CheapGate {
  verdict: "BLOCKED" | "UNVERIFIED" | "PASS";
  reasons: RuleResult[];
}

/**
 * Volume, recent prints, and minimum liquidity. A fail is BLOCKED. A missing
 * input is UNVERIFIED. PASS means the coin may spend a RugCheck, Helius, and
 * Jupiter call. Thresholds come from risk-config.json.
 */
export function cheapGate(market: CheapMarket, config: RiskConfig = riskConfig): CheapGate {
  const inputs = cheapInputs(market);
  const reasons = [volumeVsMcap(inputs, config), recentActivity(inputs, config), minLiquidity(inputs, config)];
  return { verdict: hardFilterVerdict(reasons), reasons };
}

function cheapInputs(market: CheapMarket): RiskInputs {
  const unused = unavailable("unused");
  return {
    mintAuthority: unused,
    freezeAuthority: unused,
    lpLockedPct: unused,
    onBondingCurve: unused,
    sellSimulation: unused,
    largestNonLpHolderPct: unused,
    freshWalletsInTop20: unused,
    sameSourceFundedTopHolders: unused,
    bundledClusterSupplyPct: unused,
    creatorPriorRugs: unused,
    candles: unused,
    holders: unused,
    top5Pct: unused,
    top10Pct: unused,
    feesPaidSol: unused,
    devBoughtMcapPct: unused,
    devSold: unused,
    sameNamePeers: unused,
    volume24hUsd: ok(market.volume24hUsd),
    volume5mUsd: ok(market.volume5mUsd),
    volume1hUsd: ok(market.volume1hUsd),
    marketCapUsd: ok(market.marketCapUsd),
    liquidityUsd: ok(market.liquidityUsd),
    ageHours: ok(market.ageHours),
    solUsd: ok(market.solUsd),
  };
}
