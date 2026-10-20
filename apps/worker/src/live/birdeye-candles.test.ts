import { describe, expect, it } from "vitest";
import { parseChartMember } from "./bus";
import { parsePriceMessage, parseStatsMessage, priceSubscription, statsSubscription } from "./birdeye-candles";

const MINT = "So11111111111111111111111111111111111111112";
const OTHER = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";

describe("parseChartMember", () => {
  it("reads a mint and timeframe", () => {
    expect(parseChartMember(`${MINT}|1h`)).toEqual({ mint: MINT, timeframe: "1h" });
  });

  it("rejects a bad member", () => {
    expect(parseChartMember("nope|1m")).toBeNull();
    expect(parseChartMember(`${MINT}|2m`)).toBeNull();
  });
});

describe("priceSubscription", () => {
  it("uses a raw price subscription for one chart", () => {
    expect(priceSubscription([{ mint: MINT, timeframe: "1m" }])).toEqual({
      type: "SUBSCRIBE_PRICE",
      data: {
        queryType: "simple",
        chartType: "1m",
        address: MINT,
        currency: "usd",
        mode: "raw",
        chartBy: "price",
      },
    });
  });

  it("lists each open chart in one complex query", () => {
    const message = priceSubscription([
      { mint: MINT, timeframe: "1h" },
      { mint: OTHER, timeframe: "4h" },
    ]);
    expect(message).toMatchObject({ type: "SUBSCRIBE_PRICE", data: { queryType: "complex" } });
    const query = (message?.data as { query: string }).query;
    expect(query).toContain(`address = ${MINT} AND chartType = 1H`);
    expect(query).toContain(`address = ${OTHER} AND chartType = 4H`);
  });
});

describe("statsSubscription", () => {
  it("asks for supply, market cap, liquidity, and 24h volume", () => {
    const message = statsSubscription([MINT]);
    expect(message).toMatchObject({
      type: "SUBSCRIBE_TOKEN_STATS",
      data: {
        address: MINT,
        select: {
          supply: true,
          marketcap: true,
          liquidity: true,
          trade_data: { volume: true, price_change: true, intervals: ["1h", "24h"] },
        },
      },
    });
  });
});

describe("parsePriceMessage", () => {
  it("reads a forming candle", () => {
    const candle = parsePriceMessage(
      {
        type: "PRICE_DATA",
        data: { eventType: "ohlcv", type: "1H", unixTime: 1_700_000_000, address: MINT, o: 1, h: 1.4, l: 0.9, c: 1.2, v: 8 },
      },
      "2026-10-19T12:00:00.000Z",
    );
    expect(candle).toMatchObject({ type: "token.candle", mint: MINT, timeframe: "1h", time: 1_700_000_000, close: 1.2, volume: 8 });
  });

  it("drops a candle whose close is outside the bar", () => {
    expect(
      parsePriceMessage(
        { type: "PRICE_DATA", data: { type: "1m", unixTime: 1_700_000_000, address: MINT, o: 1, h: 1.1, l: 0.9, c: 2, v: 1 } },
        "2026-10-19T12:00:00.000Z",
      ),
    ).toBeNull();
  });
});

describe("parseStatsMessage", () => {
  it("reads circulating supply and the header stats", () => {
    const stats = parseStatsMessage(
      {
        type: "TOKEN_STATS_DATA",
        data: {
          address: MINT,
          circulating_supply: 1_000,
          liquidity: 50,
          volume_24h_usd: 80,
          price_change_1h_percent: -1.5,
        },
      },
      "2026-10-19T12:00:00.000Z",
    );
    expect(stats).toMatchObject({
      type: "token.stats",
      mint: MINT,
      circulatingSupply: 1_000,
      liquidityUsd: 50,
      volume24hUsd: 80,
      priceChange1hPct: -1.5,
    });
  });

  it("returns null when none of the header fields are present", () => {
    expect(parseStatsMessage({ type: "TOKEN_STATS_DATA", data: { address: MINT } }, "2026-10-19T12:00:00.000Z")).toBeNull();
  });
});
