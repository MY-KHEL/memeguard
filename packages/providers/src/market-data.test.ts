import { describe, expect, it } from "vitest";
import type { BirdeyeProvider } from "./birdeye";
import type { GeckoTerminalProvider } from "./geckoterminal";
import type { HeliusProvider } from "./helius";
import { createMarketData } from "./market-data";
import { fail, succeed } from "./types";

const candle = (time: number) => ({ time, open: 1, high: 1, low: 1, close: 1, volume: 1 });

function stubs(opts: { birdeye?: boolean; birdeyeEmpty?: boolean; heliusOk?: boolean }) {
  const birdeye: BirdeyeProvider = {
    isConfigured: () => Boolean(opts.birdeye),
    getOhlcv: async () => succeed("birdeye", opts.birdeyeEmpty ? [] : [candle(1)], false),
    getHolders: async () => succeed("birdeye", [{ owner: "W1", uiAmount: 50, tokenAccount: null }], false),
    getTokenOverview: async () => fail("birdeye", "unavailable"),
    getTrending: async () => fail("birdeye", "unavailable"),
  };
  const geckoterminal: GeckoTerminalProvider = {
    getPoolOhlcv: async () => succeed("geckoterminal", [candle(2)], false),
    getNewPools: async () => succeed("geckoterminal", [], false),
  };
  const helius: HeliusProvider = {
    isConfigured: () => true,
    getAsset: async () => fail("helius", "unavailable"),
    getFirstTransaction: async () => fail("helius", "unavailable"),
    getSwaps: async () => fail("helius", "unavailable"),
    getTokenLargestAccounts: async () =>
      opts.heliusOk === false
        ? fail("helius", "not_configured")
        : succeed("helius", [{ tokenAccount: "TA1", amountRaw: "10", uiAmount: 10, decimals: 0 }], false),
  };
  return createMarketData({ birdeye, geckoterminal, helius });
}

describe("market-data facade", () => {
  it("uses GeckoTerminal for candles when Birdeye is not configured", async () => {
    const res = await stubs({}).getCandles({ mint: "M", pairAddress: "P" }, "5m");
    expect(res.ok && res.source).toBe("geckoterminal");
  });

  it("uses Birdeye for candles when configured, falls back when empty", async () => {
    const be = await stubs({ birdeye: true }).getCandles({ mint: "M", pairAddress: "P" }, "5m");
    expect(be.ok && be.source).toBe("birdeye");
    const fb = await stubs({ birdeye: true, birdeyeEmpty: true }).getCandles({ mint: "M", pairAddress: "P" }, "5m");
    expect(fb.ok && fb.source).toBe("geckoterminal");
  });

  it("reports unavailable when no pair address exists and Birdeye is off", async () => {
    const res = await stubs({}).getCandles({ mint: "M", pairAddress: null }, "1m");
    expect(!res.ok && res.reason).toBe("unavailable");
  });

  it("computes percent of supply for holders and marks the source", async () => {
    const he = await stubs({}).getHolders("M", 100);
    expect(he.ok && he.data[0]).toEqual({ address: "TA1", isTokenAccount: true, uiAmount: 10, pctOfSupply: 10 });
    const be = await stubs({ birdeye: true }).getHolders("M", 200);
    expect(be.ok && be.data[0]).toEqual({ address: "W1", isTokenAccount: false, uiAmount: 50, pctOfSupply: 25 });
  });

  it("passes through the Helius failure when nothing can serve holders", async () => {
    const res = await stubs({ heliusOk: false }).getHolders("M", null);
    expect(!res.ok && res.reason).toBe("not_configured");
  });
});
