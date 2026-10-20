import { z } from "zod";
import { createProviderClient, type ProviderClient } from "./client";
import { fail, type ProviderDeps, type ProviderResult } from "./types";

/**
 * CoinGecko public Demo API. Docs: https://docs.coingecko.com/reference/coins-id-ohlc
 * GET /coins/{id}/ohlc?vs_currency=usd&days=14
 * Free/demo auto-granularity for 3–30 days is 4-hour candles (interval=daily is paid).
 * Optional COINGECKO_API_KEY is sent as x-cg-demo-api-key.
 */

export const COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3";
const LIMIT_PER_MINUTE = 10;

const ohlcSchema = z.array(z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()]));

export type CoinGeckoOhlcRow = { timeMs: number; open: number; high: number; low: number; close: number };

export interface CoinGeckoProvider {
  getOhlc(id: "bitcoin" | "ethereum" | "solana", days?: 7 | 14): Promise<ProviderResult<CoinGeckoOhlcRow[]>>;
}

export function createCoinGecko(deps: ProviderDeps, client?: ProviderClient): CoinGeckoProvider {
  const key = deps.env.COINGECKO_API_KEY;
  const http =
    client ??
    createProviderClient(
      {
        name: "coingecko",
        baseUrl: deps.env.COINGECKO_BASE_URL ?? COINGECKO_BASE_URL,
        rateLimitPerMinute: LIMIT_PER_MINUTE,
        timeoutMs: 8000,
        defaultHeaders: key ? { "x-cg-demo-api-key": key } : undefined,
      },
      deps,
    );

  return {
    async getOhlc(id, days = 14) {
      const res = await http.request({
        path: `/coins/${id}/ohlc`,
        schema: ohlcSchema,
        query: { vs_currency: "usd", days },
        cache: { parts: ["ohlc", id, days], ttlSeconds: 1800 },
      });
      if (!res.ok) return res;
      if (res.data.length === 0) return fail("coingecko", "not_found", `no OHLC for ${id}`);
      return {
        ...res,
        data: res.data.map(([timeMs, open, high, low, close]) => ({ timeMs, open, high, low, close })),
      };
    },
  };
}
