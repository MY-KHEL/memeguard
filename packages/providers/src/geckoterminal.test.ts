import { describe, expect, it } from "vitest";
import { createGeckoTerminal, mintFromGeckoId, toGeckoTimeframe } from "./geckoterminal";
import { jsonResponse, testDeps } from "./test-utils";

const ohlcvBody = {
  data: {
    id: "x",
    type: "ohlcv_request_response",
    attributes: {
      ohlcv_list: [
        [1791055260, 2, 3, 1, 2.5, 100],
        [1791055200, 1, 2, 0.5, 1.5, 50],
        [1791055200, 1, 2, 0.5, 1.6, 55],
      ],
    },
  },
  meta: {},
};

const newPoolsBody = {
  data: [
    {
      id: "solana_POOL1",
      attributes: {
        address: "POOL1",
        name: "PHIL / SOL",
        pool_created_at: "2026-10-03T19:20:24Z",
        base_token_price_usd: "0.0000041",
        fdv_usd: "4100",
        market_cap_usd: null,
        reserve_in_usd: "5236.4",
        volume_usd: { m5: "10", h1: "100", h24: "1000" },
        price_change_percentage: { h1: "5.5" },
      },
      relationships: {
        base_token: { data: { id: "solana_MINT1", type: "token" } },
        quote_token: { data: { id: "solana_So11111111111111111111111111111111111111112", type: "token" } },
        dex: { data: { id: "pump-fun", type: "dex" } },
      },
    },
  ],
};

describe("geckoterminal", () => {
  it("maps timeframes to unit and aggregate", () => {
    expect(toGeckoTimeframe("5m")).toEqual({ unit: "minute", aggregate: 5 });
    expect(toGeckoTimeframe("4h")).toEqual({ unit: "hour", aggregate: 4 });
    expect(toGeckoTimeframe("1d")).toEqual({ unit: "day", aggregate: 1 });
  });

  it("strips the network prefix from token ids", () => {
    expect(mintFromGeckoId("solana_ABC")).toBe("ABC");
    expect(mintFromGeckoId("ABC")).toBe("ABC");
  });

  it("parses OHLCV arrays into sorted, deduplicated candles", async () => {
    const { deps, calls } = testDeps([jsonResponse(ohlcvBody)]);
    const res = await createGeckoTerminal(deps).getPoolOhlcv("POOL1", "5m", 100);
    expect(calls[0]?.url).toBe("https://api.geckoterminal.com/api/v2/networks/solana/pools/POOL1/ohlcv/minute?aggregate=5&limit=100");
    expect(calls[0]?.init?.headers).toMatchObject({ accept: "application/json;version=20230302" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.map((c) => c.time)).toEqual([1791055200, 1791055260]);
      expect(res.data[0]?.close).toBe(1.6);
    }
  });

  it("returns not_found for unknown pools", async () => {
    const { deps } = testDeps([jsonResponse({ errors: [] }, 404)]);
    const res = await createGeckoTerminal(deps).getPoolOhlcv("NOPE", "1m");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("not_found");
  });

  it("maps new pools to mint, dex and market fields", async () => {
    const { deps } = testDeps([jsonResponse(newPoolsBody)]);
    const res = await createGeckoTerminal(deps).getNewPools();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data[0]).toMatchObject({
        poolAddress: "POOL1",
        mint: "MINT1",
        dexId: "pump-fun",
        liquidityUsd: 5236.4,
        volume24hUsd: 1000,
        marketCapUsd: null,
        fdvUsd: 4100,
      });
    }
  });
});
