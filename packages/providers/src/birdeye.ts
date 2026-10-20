import { z } from "zod";
import { candleSchema, sortCandles, type Candle, type CandleTimeframe } from "./candles";
import { createProviderClient, type ProviderClient } from "./client";
import { fail, succeed, type ProviderDeps, type ProviderResult } from "./types";

/**
 * Birdeye Data Services. Docs: https://docs.birdeye.so (index at /llms.txt).
 * Auth: X-API-KEY header plus x-chain: solana. Rate limits are per account:
 * free "Standard" tier is limited to 3 endpoints at 1 request per second,
 * paid tiers unlock the full set at 15+ rps. We default to a conservative
 * 50 requests per minute and let the key owner raise it later via config.
 *
 * Optional provider: without BIRDEYE_API_KEY every call returns not_configured.
 * Field names below follow the public docs as of 2026-10-03 and are parsed
 * leniently (unknown fields ignored, nullable where the docs allow).
 */

export const BIRDEYE_BASE_URL = "https://public-api.birdeye.so";
const LIMIT_PER_MINUTE = 50;

const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.boolean().optional(), data });

const tokenOverviewDataSchema = z
  .object({
    address: z.string().optional(),
    symbol: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    decimals: z.number().nullable().optional(),
    price: z.number().nullable().optional(),
    liquidity: z.number().nullable().optional(),
    mc: z.number().nullable().optional(),
    marketCap: z.number().nullable().optional(),
    fdv: z.number().nullable().optional(),
    holder: z.number().nullable().optional(),
    v24hUSD: z.number().nullable().optional(),
    v1hUSD: z.number().nullable().optional(),
    priceChange1hPercent: z.number().nullable().optional(),
    priceChange24hPercent: z.number().nullable().optional(),
  })
  .passthrough();

export interface BirdeyeTokenOverview {
  mint: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  priceUsd: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  holders: number | null;
  volume24hUsd: number | null;
  volume1hUsd: number | null;
  priceChange1hPct: number | null;
  priceChange24hPct: number | null;
}

const ohlcvItemSchema = z.object({
  unixTime: z.number(),
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  v: z.number().nullable().optional(),
});

const ohlcvDataSchema = z.object({ items: z.array(ohlcvItemSchema) });

const holderItemSchema = z.object({
  owner: z.string(),
  ui_amount: z.number().nullable().optional(),
  amount: z.union([z.string(), z.number()]).nullable().optional(),
  token_account: z.string().nullable().optional(),
});

const holdersDataSchema = z.object({ items: z.array(holderItemSchema) });

export interface BirdeyeHolder {
  owner: string;
  uiAmount: number | null;
  tokenAccount: string | null;
}

const trendingDataSchema = z.object({
  tokens: z.array(
    z
      .object({
        address: z.string(),
        symbol: z.string().nullable().optional(),
        name: z.string().nullable().optional(),
        liquidity: z.number().nullable().optional(),
        volume24hUSD: z.number().nullable().optional(),
        price: z.number().nullable().optional(),
        rank: z.number().nullable().optional(),
      })
      .passthrough(),
  ),
});

export interface BirdeyeTrendingToken {
  mint: string;
  symbol: string | null;
  name: string | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceUsd: number | null;
  rank: number | null;
}

export interface BirdeyeProvider {
  isConfigured(): boolean;
  getTokenOverview(mint: string): Promise<ProviderResult<BirdeyeTokenOverview>>;
  getOhlcv(mint: string, timeframe: CandleTimeframe, fromUnix: number, toUnix: number): Promise<ProviderResult<Candle[]>>;
  getHolders(mint: string, limit?: number): Promise<ProviderResult<BirdeyeHolder[]>>;
  getTrending(limit?: number): Promise<ProviderResult<BirdeyeTrendingToken[]>>;
}

export function toBirdeyeType(tf: CandleTimeframe): string {
  switch (tf) {
    case "1m":
      return "1m";
    case "5m":
      return "5m";
    case "15m":
      return "15m";
    case "1h":
      return "1H";
    case "4h":
      return "4H";
    case "1d":
      return "1D";
  }
}

export function createBirdeye(deps: ProviderDeps, client?: ProviderClient): BirdeyeProvider {
  const apiKey = deps.env.BIRDEYE_API_KEY;
  const configured = Boolean(apiKey);
  const notConfigured = <T>() => Promise.resolve(fail<T>("birdeye", "not_configured", "BIRDEYE_API_KEY is not set"));

  const http =
    client ??
    createProviderClient(
      {
        name: "birdeye",
        baseUrl: deps.env.BIRDEYE_BASE_URL ?? BIRDEYE_BASE_URL,
        rateLimitPerMinute: LIMIT_PER_MINUTE,
        timeoutMs: 8000,
        defaultHeaders: { "X-API-KEY": apiKey ?? "", "x-chain": "solana" },
      },
      deps,
    );

  return {
    isConfigured: () => configured,

    async getTokenOverview(mint) {
      if (!configured) return notConfigured();
      const res = await http.request({
        path: "/defi/token_overview",
        query: { address: mint },
        schema: envelope(tokenOverviewDataSchema),
        cache: { parts: ["overview", mint], ttlSeconds: 30 },
      });
      if (!res.ok) return res;
      const d = res.data.data;
      return succeed(
        "birdeye",
        {
          mint,
          symbol: d.symbol ?? null,
          name: d.name ?? null,
          decimals: d.decimals ?? null,
          priceUsd: d.price ?? null,
          liquidityUsd: d.liquidity ?? null,
          marketCapUsd: d.marketCap ?? d.mc ?? null,
          fdvUsd: d.fdv ?? null,
          holders: d.holder ?? null,
          volume24hUsd: d.v24hUSD ?? null,
          volume1hUsd: d.v1hUSD ?? null,
          priceChange1hPct: d.priceChange1hPercent ?? null,
          priceChange24hPct: d.priceChange24hPercent ?? null,
        },
        res.fromCache,
      );
    },

    async getOhlcv(mint, timeframe, fromUnix, toUnix) {
      if (!configured) return notConfigured();
      const res = await http.request({
        path: "/defi/v3/ohlcv",
        query: { address: mint, type: toBirdeyeType(timeframe), time_from: fromUnix, time_to: toUnix },
        schema: envelope(ohlcvDataSchema),
        cache: { parts: ["ohlcv", mint, timeframe, fromUnix, toUnix], ttlSeconds: 30 },
      });
      if (!res.ok) return res;
      const candles = res.data.data.items.map((i) =>
        candleSchema.parse({ time: i.unixTime, open: i.o, high: i.h, low: i.l, close: i.c, volume: Math.max(0, i.v ?? 0) }),
      );
      return succeed("birdeye", sortCandles(candles), res.fromCache);
    },

    async getHolders(mint, limit = 20) {
      if (!configured) return notConfigured();
      const res = await http.request({
        path: "/defi/v3/token/holder",
        query: { address: mint, offset: 0, limit: Math.min(limit, 100) },
        schema: envelope(holdersDataSchema),
        cache: { parts: ["holders", mint, limit], ttlSeconds: 60 },
      });
      if (!res.ok) return res;
      return succeed(
        "birdeye",
        res.data.data.items.map((h) => ({ owner: h.owner, uiAmount: h.ui_amount ?? null, tokenAccount: h.token_account ?? null })),
        res.fromCache,
      );
    },

    async getTrending(limit = 20) {
      if (!configured) return notConfigured();
      const res = await http.request({
        path: "/defi/token_trending",
        query: { sort_by: "rank", sort_type: "asc", offset: 0, limit: Math.min(limit, 20) },
        schema: envelope(trendingDataSchema),
        cache: { parts: ["trending", limit], ttlSeconds: 60 },
      });
      if (!res.ok) return res;
      return succeed(
        "birdeye",
        res.data.data.tokens.map((t) => ({
          mint: t.address,
          symbol: t.symbol ?? null,
          name: t.name ?? null,
          liquidityUsd: t.liquidity ?? null,
          volume24hUsd: t.volume24hUSD ?? null,
          priceUsd: t.price ?? null,
          rank: t.rank ?? null,
        })),
        res.fromCache,
      );
    },
  };
}
