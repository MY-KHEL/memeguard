import { z } from "zod";
import { candleSchema, sortCandles, type Candle, type CandleTimeframe } from "./candles";
import { createProviderClient, type ProviderClient } from "./client";
import { succeed, type ProviderDeps, type ProviderResult } from "./types";

/**
 * GeckoTerminal public API (free, no key, about 30 requests per minute).
 * Docs now live under https://docs.coingecko.com (onchain endpoints).
 * Response shapes probed live on 2026-10-03:
 *   GET /networks/solana/new_pools        -> { data: [{ id, attributes: {...}, relationships: { base_token, dex } }] }
 *   GET /networks/solana/pools/{pool}/ohlcv/{minute|hour|day}?aggregate=&limit=
 *                                         -> { data: { attributes: { ohlcv_list: [[ts, o, h, l, c, v], ...] } }, meta }
 */

export const GECKOTERMINAL_BASE_URL = "https://api.geckoterminal.com/api/v2";
const LIMIT_PER_MINUTE = 30;
const ACCEPT = "application/json;version=20230302";

const numericString = z.union([z.string(), z.number()]).transform(Number).pipe(z.number()).nullable().optional();

const poolSchema = z.object({
  id: z.string(),
  attributes: z.object({
    address: z.string(),
    name: z.string().nullable().optional(),
    pool_created_at: z.string().nullable().optional(),
    base_token_price_usd: numericString,
    fdv_usd: numericString,
    market_cap_usd: numericString,
    reserve_in_usd: numericString,
    volume_usd: z.record(z.string(), numericString).optional(),
    price_change_percentage: z.record(z.string(), numericString).optional(),
  }),
  relationships: z
    .object({
      base_token: z.object({ data: z.object({ id: z.string() }) }).optional(),
      quote_token: z.object({ data: z.object({ id: z.string() }) }).optional(),
      dex: z.object({ data: z.object({ id: z.string() }) }).optional(),
    })
    .optional(),
});

const newPoolsSchema = z.object({ data: z.array(poolSchema) });

const ohlcvSchema = z.object({
  data: z.object({
    attributes: z.object({
      ohlcv_list: z.array(z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()])),
    }),
  }),
});

export interface GeckoNewPool {
  poolAddress: string;
  mint: string;
  dexId: string | null;
  name: string | null;
  createdAt: string | null;
  priceUsd: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  volume24hUsd: number | null;
}

export interface GeckoTerminalProvider {
  getPoolOhlcv(poolAddress: string, timeframe: CandleTimeframe, limit?: number): Promise<ProviderResult<Candle[]>>;
  getNewPools(page?: number): Promise<ProviderResult<GeckoNewPool[]>>;
}

/** GeckoTerminal paths use minute/hour/day plus an aggregate multiplier. */
export function toGeckoTimeframe(tf: CandleTimeframe): { unit: "minute" | "hour" | "day"; aggregate: number } {
  switch (tf) {
    case "1m":
      return { unit: "minute", aggregate: 1 };
    case "5m":
      return { unit: "minute", aggregate: 5 };
    case "15m":
      return { unit: "minute", aggregate: 15 };
    case "1h":
      return { unit: "hour", aggregate: 1 };
    case "4h":
      return { unit: "hour", aggregate: 4 };
    case "1d":
      return { unit: "day", aggregate: 1 };
  }
}

/** Token ids look like "solana_<mint>". */
export function mintFromGeckoId(id: string): string {
  const idx = id.indexOf("_");
  return idx >= 0 ? id.slice(idx + 1) : id;
}

export function createGeckoTerminal(deps: ProviderDeps, client?: ProviderClient): GeckoTerminalProvider {
  const http =
    client ??
    createProviderClient(
      {
        name: "geckoterminal",
        baseUrl: deps.env.GECKOTERMINAL_BASE_URL ?? GECKOTERMINAL_BASE_URL,
        rateLimitPerMinute: LIMIT_PER_MINUTE,
        timeoutMs: 8000,
        defaultHeaders: { accept: ACCEPT },
      },
      deps,
    );

  return {
    async getPoolOhlcv(poolAddress, timeframe, limit = 300) {
      const { unit, aggregate } = toGeckoTimeframe(timeframe);
      const res = await http.request({
        path: `/networks/solana/pools/${poolAddress}/ohlcv/${unit}`,
        query: { aggregate, limit: Math.min(Math.max(limit, 1), 1000) },
        schema: ohlcvSchema,
        cache: { parts: ["ohlcv", poolAddress, timeframe, limit], ttlSeconds: 30 },
        notFoundStatuses: [404],
      });
      if (!res.ok) return res;
      const candles = res.data.data.attributes.ohlcv_list.map(([time, open, high, low, close, volume]) =>
        candleSchema.parse({ time, open, high, low, close, volume: Math.max(0, volume) }),
      );
      return succeed("geckoterminal", sortCandles(candles), res.fromCache);
    },

    async getNewPools(page = 1) {
      const res = await http.request({
        path: "/networks/solana/new_pools",
        query: { page },
        schema: newPoolsSchema,
        cache: { parts: ["new_pools", page], ttlSeconds: 15 },
      });
      if (!res.ok) return res;
      const pools: GeckoNewPool[] = res.data.data
        .filter((p) => p.relationships?.base_token?.data.id)
        .map((p) => ({
          poolAddress: p.attributes.address,
          mint: mintFromGeckoId(p.relationships!.base_token!.data.id),
          dexId: p.relationships?.dex?.data.id ?? null,
          name: p.attributes.name ?? null,
          createdAt: p.attributes.pool_created_at ?? null,
          priceUsd: p.attributes.base_token_price_usd ?? null,
          liquidityUsd: p.attributes.reserve_in_usd ?? null,
          marketCapUsd: p.attributes.market_cap_usd ?? null,
          fdvUsd: p.attributes.fdv_usd ?? null,
          volume24hUsd: p.attributes.volume_usd?.h24 ?? null,
        }));
      return succeed("geckoterminal", pools, res.fromCache);
    },
  };
}
