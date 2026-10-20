import type { BirdeyeProvider } from "./birdeye";
import { TIMEFRAME_SECONDS, type Candle, type CandleTimeframe } from "./candles";
import type { GeckoTerminalProvider } from "./geckoterminal";
import type { HeliusProvider } from "./helius";
import { fail, type ProviderName, type ProviderResult } from "./types";

/**
 * Facade over the market-data providers. Picks Birdeye when configured,
 * otherwise GeckoTerminal for candles and Helius for holders, and reports
 * which source answered so the UI can say exactly what was unavailable.
 */

export interface TokenRefForCandles {
  mint: string;
  /** Pool address needed by GeckoTerminal. */
  pairAddress: string | null;
}

export interface Holder {
  /** Owner wallet when known, otherwise the token account address. */
  address: string;
  isTokenAccount: boolean;
  uiAmount: number | null;
  /** Percent of total supply when supply is known. */
  pctOfSupply: number | null;
}

export interface MarketDataFacade {
  getCandles(token: TokenRefForCandles, timeframe: CandleTimeframe, limit?: number): Promise<ProviderResult<Candle[]>>;
  getHolders(mint: string, supplyUi: number | null, limit?: number): Promise<ProviderResult<Holder[]>>;
}

export function createMarketData(p: {
  birdeye: BirdeyeProvider;
  geckoterminal: GeckoTerminalProvider;
  helius: HeliusProvider;
  now?: () => number;
}): MarketDataFacade {
  const now = p.now ?? Date.now;

  return {
    async getCandles(token, timeframe, limit = 300) {
      if (p.birdeye.isConfigured()) {
        const toUnix = Math.floor(now() / 1000);
        const fromUnix = toUnix - TIMEFRAME_SECONDS[timeframe] * limit;
        const be = await p.birdeye.getOhlcv(token.mint, timeframe, fromUnix, toUnix);
        if (be.ok && be.data.length > 0) return be;
        // fall through to GeckoTerminal on failure or empty data
      }
      if (!token.pairAddress) {
        return fail("geckoterminal", "unavailable", "no pair address known for this token yet");
      }
      return p.geckoterminal.getPoolOhlcv(token.pairAddress, timeframe, limit);
    },

    async getHolders(mint, supplyUi, limit = 20) {
      const pct = (ui: number | null) => (ui !== null && supplyUi && supplyUi > 0 ? (ui / supplyUi) * 100 : null);

      if (p.birdeye.isConfigured()) {
        const be = await p.birdeye.getHolders(mint, limit);
        if (be.ok) {
          return {
            ...be,
            data: be.data.map((h) => ({ address: h.owner, isTokenAccount: false, uiAmount: h.uiAmount, pctOfSupply: pct(h.uiAmount) })),
          };
        }
      }

      const he = await p.helius.getTokenLargestAccounts(mint);
      if (!he.ok) return he as ProviderResult<Holder[]>;
      return {
        ...he,
        data: he.data.slice(0, limit).map((a) => ({
          address: a.tokenAccount,
          isTokenAccount: true,
          uiAmount: a.uiAmount,
          pctOfSupply: pct(a.uiAmount),
        })),
      };
    },
  };
}

export type { ProviderName };
