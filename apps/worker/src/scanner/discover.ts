import type { DexScreenerProvider, GeckoTerminalProvider, ProviderResult } from "@meme-guard/providers";

/**
 * Discovery: collect candidate Solana mints from every cheap listing source.
 * Each source failing is recorded, never thrown; a cycle with zero sources
 * available still completes so tracked coins keep refreshing.
 */

export interface DiscoveredToken {
  mint: string;
  /** Pool address when the source provides one (GeckoTerminal). */
  pairAddress: string | null;
  source: "profiles" | "boosts_latest" | "boosts_top" | "gecko_new_pools";
}

export interface DiscoveryOutcome {
  tokens: DiscoveredToken[];
  errors: Array<{ source: string; reason: string; error?: string }>;
}

export function mergeDiscovered(lists: DiscoveredToken[][]): DiscoveredToken[] {
  const byMint = new Map<string, DiscoveredToken>();
  for (const list of lists) {
    for (const t of list) {
      const existing = byMint.get(t.mint);
      if (!existing) byMint.set(t.mint, t);
      else if (!existing.pairAddress && t.pairAddress) byMint.set(t.mint, { ...existing, pairAddress: t.pairAddress });
    }
  }
  return [...byMint.values()];
}

export async function discoverTokens(p: {
  dexscreener: DexScreenerProvider;
  geckoterminal: GeckoTerminalProvider;
  useGeckoNewPools: boolean;
}): Promise<DiscoveryOutcome> {
  const errors: DiscoveryOutcome["errors"] = [];
  const lists: DiscoveredToken[][] = [];

  const collect = <T>(source: DiscoveredToken["source"], res: ProviderResult<T[]>, map: (item: T) => DiscoveredToken | null) => {
    if (!res.ok) {
      errors.push({ source, reason: res.reason, error: res.error });
      return;
    }
    lists.push(res.data.map(map).filter((t): t is DiscoveredToken => t !== null));
  };

  const [profiles, boostsLatest, boostsTop, geckoPools] = await Promise.all([
    p.dexscreener.getLatestProfiles(),
    p.dexscreener.getLatestBoosts(),
    p.dexscreener.getTopBoosts(),
    p.useGeckoNewPools ? p.geckoterminal.getNewPools() : Promise.resolve(null),
  ]);

  const solanaOnly = (source: DiscoveredToken["source"]) => (ref: { chainId: string; tokenAddress: string }) =>
    ref.chainId === "solana" ? { mint: ref.tokenAddress, pairAddress: null, source } : null;

  collect("profiles", profiles, solanaOnly("profiles"));
  collect("boosts_latest", boostsLatest, solanaOnly("boosts_latest"));
  collect("boosts_top", boostsTop, solanaOnly("boosts_top"));
  if (geckoPools) {
    collect("gecko_new_pools", geckoPools, (pool) => ({ mint: pool.mint, pairAddress: pool.poolAddress, source: "gecko_new_pools" }));
  }

  return { tokens: mergeDiscovered(lists), errors };
}
