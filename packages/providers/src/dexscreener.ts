import { z } from "zod";
import { createProviderClient, type ProviderClient } from "./client";
import { fail, succeed, type ProviderDeps, type ProviderResult } from "./types";

/**
 * DexScreener public API. Docs: https://docs.dexscreener.com/api/reference
 * - profiles / boosts endpoints: 60 requests per minute, return chainId + tokenAddress only
 * - tokens / pairs / search endpoints: 300 requests per minute
 * No API key. Rate limits re-checked 2026-10-03.
 */

export const DEXSCREENER_BASE_URL = "https://api.dexscreener.com";
const DISCOVERY_LIMIT_PER_MINUTE = 60;
const MARKET_LIMIT_PER_MINUTE = 300;
export const DEXSCREENER_BATCH_SIZE = 30;
/** Keep market fan-out small so a 1500-mint scan cannot open 50 fetches at once. */
const MARKET_BATCH_CONCURRENCY = 2;

const numberish = z.union([z.number(), z.string().transform(Number)]).pipe(z.number()).nullable().optional();

export const tokenRefSchema = z.object({
  chainId: z.string(),
  tokenAddress: z.string(),
  url: z.string().optional(),
  icon: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});
export type DexTokenRef = z.infer<typeof tokenRefSchema>;

export const boostRefSchema = tokenRefSchema.extend({
  amount: z.number().nullable().optional(),
  totalAmount: z.number().nullable().optional(),
});

const timeframeNumbers = z.record(z.string(), z.number().nullable()).optional();

export const pairSchema = z.object({
  chainId: z.string(),
  dexId: z.string(),
  url: z.string().optional(),
  pairAddress: z.string(),
  labels: z.array(z.string()).nullable().optional(),
  baseToken: z.object({ address: z.string(), name: z.string().nullable().optional(), symbol: z.string().nullable().optional() }),
  quoteToken: z.object({
    address: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    symbol: z.string().nullable().optional(),
  }),
  priceNative: z.string().nullable().optional(),
  priceUsd: z.string().nullable().optional(),
  txns: z.record(z.string(), z.object({ buys: z.number().nullable().optional(), sells: z.number().nullable().optional() })).optional(),
  volume: timeframeNumbers,
  priceChange: timeframeNumbers.nullable(),
  liquidity: z
    .object({ usd: z.number().nullable().optional(), base: z.number().nullable().optional(), quote: z.number().nullable().optional() })
    .nullable()
    .optional(),
  fdv: numberish,
  marketCap: numberish,
  pairCreatedAt: z.number().nullable().optional(),
  info: z
    .object({
      imageUrl: z.string().nullable().optional(),
      websites: z.array(z.object({ url: z.string() })).nullable().optional(),
      socials: z.array(z.object({ platform: z.string().optional(), type: z.string().optional(), handle: z.string().optional(), url: z.string().optional() })).nullable().optional(),
    })
    .nullable()
    .optional(),
  boosts: z.object({ active: z.number().nullable().optional() }).nullable().optional(),
});
export type DexPair = z.infer<typeof pairSchema>;

const pairsArraySchema = z.array(pairSchema);
const searchSchema = z.object({ pairs: z.array(pairSchema).nullable() });

export interface DexScreenerProvider {
  getLatestProfiles(): Promise<ProviderResult<DexTokenRef[]>>;
  getLatestBoosts(): Promise<ProviderResult<DexTokenRef[]>>;
  getTopBoosts(): Promise<ProviderResult<DexTokenRef[]>>;
  /** Pairs for up to 30 token addresses per upstream call; larger inputs are chunked. */
  getTokens(chainId: string, tokenAddresses: string[], opts?: { ttlSeconds?: number }): Promise<ProviderResult<DexPair[]>>;
  getTokenPairs(chainId: string, tokenAddress: string): Promise<ProviderResult<DexPair[]>>;
  search(query: string): Promise<ProviderResult<DexPair[]>>;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    out.push(...(await Promise.all(items.slice(i, i + concurrency).map(fn))));
  }
  return out;
}

export function createDexScreener(deps: ProviderDeps, client?: ProviderClient): DexScreenerProvider {
  const http =
    client ??
    createProviderClient(
      {
        name: "dexscreener",
        baseUrl: deps.env.DEXSCREENER_BASE_URL ?? DEXSCREENER_BASE_URL,
        rateLimitPerMinute: MARKET_LIMIT_PER_MINUTE,
        timeoutMs: 8000,
      },
      deps,
    );

  const discovery = (path: string, schema: z.ZodType<DexTokenRef[]>, cacheName: string) =>
    http.request({
      path,
      schema,
      bucket: "dexscreener:discovery",
      bucketLimitPerMinute: DISCOVERY_LIMIT_PER_MINUTE,
      cache: { parts: [cacheName], ttlSeconds: 15 },
    });

  return {
    getLatestProfiles: () => discovery("/token-profiles/latest/v1", z.array(tokenRefSchema), "profiles:latest"),
    getLatestBoosts: () => discovery("/token-boosts/latest/v1", z.array(boostRefSchema), "boosts:latest"),
    getTopBoosts: () => discovery("/token-boosts/top/v1", z.array(boostRefSchema), "boosts:top"),

    async getTokens(chainId, tokenAddresses, opts) {
      const unique = [...new Set(tokenAddresses.filter(Boolean))];
      if (unique.length === 0) return succeed("dexscreener", [], false);
      const ttlSeconds = opts?.ttlSeconds ?? 15;

      const batches = chunk(unique, DEXSCREENER_BATCH_SIZE);
      const results = await mapPool(batches, MARKET_BATCH_CONCURRENCY, (batch) =>
        http.request({
          path: `/tokens/v1/${chainId}/${batch.join(",")}`,
          schema: pairsArraySchema,
          bucket: "dexscreener:market",
          cache: { parts: ["tokens", chainId, batch.join(","), ttlSeconds], ttlSeconds },
        }),
      );

      const pairs: DexPair[] = [];
      let anyOk = false;
      let fromCache = true;
      let firstFailure: ProviderResult<DexPair[]> | undefined;
      for (const r of results) {
        if (r.ok) {
          anyOk = true;
          fromCache = fromCache && r.fromCache;
          pairs.push(...r.data);
        } else {
          firstFailure ??= r;
        }
      }
      if (!anyOk && firstFailure) return firstFailure;
      if (firstFailure) {
        deps.log.warn({ failed: results.filter((r) => !r.ok).length, total: results.length }, "dexscreener partial batch failure");
      }
      return succeed("dexscreener", pairs, fromCache);
    },

    getTokenPairs: (chainId, tokenAddress) =>
      http.request({
        path: `/token-pairs/v1/${chainId}/${tokenAddress}`,
        schema: pairsArraySchema,
        bucket: "dexscreener:market",
        cache: { parts: ["token-pairs", chainId, tokenAddress], ttlSeconds: 15 },
      }),

    async search(query) {
      const q = query.trim();
      if (!q) return fail("dexscreener", "invalid_response", "empty query");
      const res = await http.request({
        path: "/latest/dex/search",
        schema: searchSchema,
        query: { q },
        bucket: "dexscreener:market",
        cache: { parts: ["search", q.toLowerCase()], ttlSeconds: 30 },
      });
      if (!res.ok) return res;
      return succeed("dexscreener", res.data.pairs ?? [], res.fromCache);
    },
  };
}

/** Pick the most representative pair for a token: highest USD liquidity, ties prefer launchpad or raydium. */
export function pickBestPair(pairs: DexPair[], tokenAddress: string): DexPair | undefined {
  const own = pairs.filter((p) => p.baseToken.address === tokenAddress);
  if (own.length === 0) return undefined;
  const preferred = (p: DexPair) => (p.dexId === "pumpfun" || p.dexId === "raydium" || (p.labels ?? []).includes("CLMM") ? 1 : 0);
  return [...own].sort((a, b) => {
    const liq = (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0);
    if (liq !== 0) return liq;
    return preferred(b) - preferred(a);
  })[0];
}

/** Launchpad label from dex id and pair labels. */
export function launchpadFromPair(pair: DexPair): string | null {
  const dex = pair.dexId.toLowerCase();
  if (dex.includes("pump")) return "pump.fun";
  if (dex.includes("moonshot")) return "moonshot";
  if (dex.includes("launchlab") || dex.includes("bonk")) return "launchlab";
  if (dex.includes("meteora") && (pair.labels ?? []).some((l) => l.toLowerCase().includes("dbc"))) return "meteora-dbc";
  return null;
}
