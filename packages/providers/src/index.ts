/**
 * One module per external API (docs/SPEC.md section 5).
 * Every provider returns ProviderResult, caches, rate limits, and never
 * throws on upstream failure.
 */
import { createBirdeye, type BirdeyeProvider } from "./birdeye";
import { createDexScreener, type DexScreenerProvider } from "./dexscreener";
import { createGeckoTerminal, type GeckoTerminalProvider } from "./geckoterminal";
import { createHelius, type HeliusProvider } from "./helius";
import { createCoinGecko, type CoinGeckoProvider } from "./coingecko";
import { createJupiter, type JupiterProvider } from "./jupiter";
import { createMarketData, type MarketDataFacade } from "./market-data";
import { createRugCheck, type RugCheckProvider } from "./rugcheck";
import type { ProviderDeps } from "./types";

export * from "./types";
export * from "./candles";
export { fetchJson } from "./http";
export { createCache, cacheKey, type ProviderCache } from "./cache";
export { createRateLimiter, createMemoryStore, type RateLimiter } from "./rate-limit";
export { createProviderClient, type ProviderClient, type ProviderClientConfig, type RequestOptions } from "./client";
export * from "./dexscreener";
export * from "./geckoterminal";
export * from "./birdeye";
export * from "./helius";
export * from "./rugcheck";
export * from "./jupiter";
export * from "./coingecko";
export * from "./market-data";

export interface Providers {
  dexscreener: DexScreenerProvider;
  geckoterminal: GeckoTerminalProvider;
  birdeye: BirdeyeProvider;
  helius: HeliusProvider;
  rugcheck: RugCheckProvider;
  jupiter: JupiterProvider;
  coingecko: CoinGeckoProvider;
  marketData: MarketDataFacade;
  /** Which optional providers have credentials. Missing means UNVERIFIED downstream, never a pass. */
  configured: { birdeye: boolean; helius: boolean; jupiter: boolean };
}

export function createProviders(deps: ProviderDeps): Providers {
  const dexscreener = createDexScreener(deps);
  const geckoterminal = createGeckoTerminal(deps);
  const birdeye = createBirdeye(deps);
  const helius = createHelius(deps);
  const rugcheck = createRugCheck(deps);
  const jupiter = createJupiter(deps);
  const coingecko = createCoinGecko(deps);
  const marketData = createMarketData({ birdeye, geckoterminal, helius, now: deps.now });
  return {
    dexscreener,
    geckoterminal,
    birdeye,
    helius,
    rugcheck,
    jupiter,
    coingecko,
    marketData,
    configured: { birdeye: birdeye.isConfigured(), helius: helius.isConfigured(), jupiter: jupiter.isConfigured() },
  };
}
