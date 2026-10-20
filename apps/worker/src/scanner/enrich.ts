import { launchpadFromPair, pickBestPair, type DexPair } from "@meme-guard/providers";

/**
 * Turn DexScreener pairs into the rows the scanner writes. Pure functions so
 * the mapping is unit-tested without a database or network.
 */

export interface TokenUpsertRow {
  mint: string;
  symbol: string | null;
  name: string | null;
  createdAt: Date | null;
  launchpad: string | null;
  pairAddress: string | null;
  dexId: string | null;
  imageUrl: string | null;
  latestPrice: string | null;
  latestMarketCap: string | null;
  latestLiquidityUsd: string | null;
  latestVolume24h: string | null;
  latestPriceChange1h: string | null;
  lastSnapshotAt: Date | null;
}

export interface SnapshotRow {
  mint: string;
  ts: Date;
  price: string | null;
  marketCap: string | null;
  liquidityUsd: string | null;
  volume5m: string | null;
  volume1h: string | null;
  volume24h: string | null;
}

/** Postgres numeric accepts plain and scientific notation; reject NaN and infinities. */
export function toNumeric(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return null;
  return String(n);
}

/** numeric(9,4) for percentages: clamp absurd values so a bad upstream number never fails the whole batch. */
export function toPct(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const clamped = Math.max(-99999, Math.min(99999, value));
  return clamped.toFixed(4);
}

export function groupPairsByMint(pairs: DexPair[]): Map<string, DexPair[]> {
  const map = new Map<string, DexPair[]>();
  for (const pair of pairs) {
    const list = map.get(pair.baseToken.address) ?? [];
    list.push(pair);
    map.set(pair.baseToken.address, list);
  }
  return map;
}

/** A token with no pair data yet still gets a row so it appears (with dashes) and is retried next cycle. */
export function emptyTokenRow(mint: string, pairAddress: string | null = null): TokenUpsertRow {
  return {
    mint,
    symbol: null,
    name: null,
    createdAt: null,
    launchpad: null,
    pairAddress,
    dexId: null,
    imageUrl: null,
    latestPrice: null,
    latestMarketCap: null,
    latestLiquidityUsd: null,
    latestVolume24h: null,
    latestPriceChange1h: null,
    lastSnapshotAt: null,
  };
}

export function buildRows(mint: string, pairs: DexPair[], now: Date): { token: TokenUpsertRow; snapshot: SnapshotRow | null } {
  const best = pickBestPair(pairs, mint);
  if (!best) return { token: emptyTokenRow(mint), snapshot: null };

  const marketCap = best.marketCap ?? best.fdv ?? null;
  const token: TokenUpsertRow = {
    mint,
    symbol: best.baseToken.symbol ?? null,
    name: best.baseToken.name ?? null,
    createdAt: best.pairCreatedAt ? new Date(best.pairCreatedAt) : null,
    launchpad: launchpadFromPair(best),
    pairAddress: best.pairAddress,
    dexId: best.dexId,
    imageUrl: best.info?.imageUrl ?? null,
    latestPrice: toNumeric(best.priceUsd),
    latestMarketCap: toNumeric(marketCap),
    latestLiquidityUsd: toNumeric(best.liquidity?.usd),
    latestVolume24h: toNumeric(best.volume?.h24),
    latestPriceChange1h: toPct(best.priceChange?.h1),
    lastSnapshotAt: now,
  };
  const snapshot: SnapshotRow = {
    mint,
    ts: now,
    price: token.latestPrice,
    marketCap: token.latestMarketCap,
    liquidityUsd: token.latestLiquidityUsd,
    volume5m: toNumeric(best.volume?.m5),
    volume1h: toNumeric(best.volume?.h1),
    volume24h: token.latestVolume24h,
  };
  return { token, snapshot };
}
