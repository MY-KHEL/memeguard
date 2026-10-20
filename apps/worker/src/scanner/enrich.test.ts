import { describe, expect, it } from "vitest";
import type { DexPair } from "@meme-guard/providers";
import { buildRows, groupPairsByMint, toNumeric, toPct } from "./enrich";
import { mergeDiscovered } from "./discover";

const pair = (over: Partial<DexPair> = {}): DexPair => ({
  chainId: "solana",
  dexId: "pumpfun",
  pairAddress: "PAIR1",
  baseToken: { address: "MINT1", name: "Coin", symbol: "COIN" },
  quoteToken: { address: "So111", symbol: "SOL" },
  priceUsd: "0.00001234",
  volume: { m5: 10, h1: 100, h24: 1000 },
  priceChange: { h1: 12.3456789 },
  liquidity: { usd: 5000 },
  marketCap: 12345.678,
  pairCreatedAt: 1791055200000,
  info: { imageUrl: "https://img" },
  ...over,
});

describe("enrich", () => {
  it("converts numbers to numeric strings and rejects non-finite", () => {
    expect(toNumeric(1e-7)).toBe("1e-7");
    expect(toNumeric("0.5")).toBe("0.5");
    expect(toNumeric(Number.NaN)).toBeNull();
    expect(toNumeric(null)).toBeNull();
    expect(toPct(12.3456789)).toBe("12.3457");
    expect(toPct(1e9)).toBe("99999.0000");
  });

  it("groups pairs by base token", () => {
    const g = groupPairsByMint([pair(), pair({ pairAddress: "P2" }), pair({ baseToken: { address: "MINT2" } })]);
    expect(g.get("MINT1")?.length).toBe(2);
    expect(g.get("MINT2")?.length).toBe(1);
  });

  it("builds a token row and snapshot from the best pair", () => {
    const now = new Date("2026-10-03T00:00:00Z");
    const { token, snapshot } = buildRows("MINT1", [pair({ liquidity: { usd: 10 }, pairAddress: "LOW" }), pair()], now);
    expect(token).toMatchObject({
      mint: "MINT1",
      symbol: "COIN",
      launchpad: "pump.fun",
      pairAddress: "PAIR1",
      imageUrl: "https://img",
      latestPrice: "0.00001234",
      latestMarketCap: "12345.678",
      latestLiquidityUsd: "5000",
      latestVolume24h: "1000",
      latestPriceChange1h: "12.3457",
      lastSnapshotAt: now,
    });
    expect(token.createdAt?.toISOString()).toBe("2026-10-03T19:20:00.000Z");
    expect(snapshot).toMatchObject({ mint: "MINT1", volume5m: "10", volume1h: "100", volume24h: "1000" });
  });

  it("falls back to fdv when market cap is missing and yields an empty row with no pairs", () => {
    const now = new Date();
    expect(buildRows("MINT1", [pair({ marketCap: null, fdv: 42 })], now).token.latestMarketCap).toBe("42");
    const empty = buildRows("MINT1", [pair({ baseToken: { address: "OTHER" } })], now);
    expect(empty.snapshot).toBeNull();
    expect(empty.token.symbol).toBeNull();
  });

  it("merges discovered tokens by mint, keeping a pair address when any source has one", () => {
    const merged = mergeDiscovered([
      [{ mint: "A", pairAddress: null, source: "profiles" }],
      [
        { mint: "A", pairAddress: "POOL", source: "gecko_new_pools" },
        { mint: "B", pairAddress: null, source: "boosts_top" },
      ],
    ]);
    expect(merged).toEqual([
      { mint: "A", pairAddress: "POOL", source: "profiles" },
      { mint: "B", pairAddress: null, source: "boosts_top" },
    ]);
  });
});
