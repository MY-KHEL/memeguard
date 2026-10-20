import { riskConfig, type RiskConfig } from "./config";
import { ok, unavailable, type CandleInput, type RiskInputs } from "./types";

export function passingInputs(over: Partial<RiskInputs> = {}): RiskInputs {
  return {
    mintAuthority: ok(null),
    freezeAuthority: ok(null),
    lpLockedPct: ok(95),
    onBondingCurve: ok(false),
    sellSimulation: ok({ quoted: true, priceImpactPct: 2 }),
    largestNonLpHolderPct: ok(2),
    freshWalletsInTop20: ok(1),
    sameSourceFundedTopHolders: ok(1),
    bundledClusterSupplyPct: ok(5),
    creatorPriorRugs: ok(0),
    candles: ok(variedCandles(24)),
  volume24hUsd: ok(80_000),
  volume5mUsd: ok(500),
  volume1hUsd: ok(2_000),
  marketCapUsd: ok(80_000),
    holders: ok(400),
    liquidityUsd: ok(20_000),
    solUsd: ok(150),
    top5Pct: ok(18),
    top10Pct: ok(28),
    ageHours: ok(12),
    feesPaidSol: unavailable("none", "no fee source"),
    devBoughtMcapPct: ok(2),
    devSold: ok(false),
    sameNamePeers: ok(0),
    ...over,
  };
}

export function variedCandles(n: number): CandleInput[] {
  const out: CandleInput[] = [];
  let price = 1;
  for (let i = 0; i < n; i++) {
    const dir = i % 3 === 0 ? -1 : 1;
    const open = price;
    const close = price * (1 + dir * (0.01 + (i % 5) * 0.004));
    out.push({
      time: 1_700_000_000 + i * 60,
      open,
      high: Math.max(open, close) * 1.01,
      low: Math.min(open, close) * 0.99,
      close,
      volume: 100 + i * 7,
    });
    price = close;
  }
  return out;
}

export function upOnlyCandles(n: number): CandleInput[] {
  const out: CandleInput[] = [];
  let price = 1;
  for (let i = 0; i < n; i++) {
    const open = price;
    const close = price * 1.02;
    out.push({ time: 1_700_000_000 + i * 60, open, high: close, low: open, close, volume: 10 });
    price = close;
  }
  return out;
}

export { riskConfig };
export type { RiskConfig };
