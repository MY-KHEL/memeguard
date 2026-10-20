import type { HeliusFirstTx, HeliusProvider, RugCheckHolder } from "@meme-guard/providers";

export interface WalletAnalysisRow {
  wallet: string;
  walletAgeDays: number | null;
  isFresh: boolean | null;
  fundingSource: string | null;
  clusterId: string | null;
  isBundlerFlag: boolean;
}

export interface WalletAnalysis {
  rows: WalletAnalysisRow[];
  freshCount: number;
  maxSameSource: number;
  bundledPct: number;
  /** True when at least one holder wallet could not be aged. */
  unverified: boolean;
}

export function ageDays(timestamp: number | null, nowMs: number): number | null {
  if (timestamp === null || timestamp <= 0) return null;
  return Math.floor((nowMs / 1000 - timestamp) / 86_400);
}

export function assignClusters(
  rows: Array<{ wallet: string; fundingSource: string | null }>,
  insiderGroups: Array<{ id: string; wallets: string[] }>,
): Map<string, string> {
  const cluster = new Map<string, string>();
  const bySource = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.fundingSource) continue;
    const list = bySource.get(row.fundingSource) ?? [];
    list.push(row.wallet);
    bySource.set(row.fundingSource, list);
  }
  for (const [source, wallets] of bySource) {
    if (wallets.length < 2) continue;
    const id = `fund:${source}`;
    for (const w of wallets) cluster.set(w, id);
  }
  for (const group of insiderGroups) {
    for (const w of group.wallets) {
      if (!cluster.has(w)) cluster.set(w, `insider:${group.id}`);
    }
  }
  return cluster;
}

export function summariseWallets(
  rows: WalletAnalysisRow[],
  holderPctByWallet: Map<string, number>,
): Pick<WalletAnalysis, "freshCount" | "maxSameSource" | "bundledPct"> {
  const freshCount = rows.filter((r) => r.isFresh === true).length;
  const bySource = new Map<string, number>();
  for (const row of rows) {
    if (!row.fundingSource) continue;
    bySource.set(row.fundingSource, (bySource.get(row.fundingSource) ?? 0) + 1);
  }
  const maxSameSource = [...bySource.values()].reduce((m, n) => Math.max(m, n), 0);
  const byCluster = new Map<string, number>();
  for (const row of rows) {
    if (!row.clusterId) continue;
    byCluster.set(row.clusterId, (byCluster.get(row.clusterId) ?? 0) + (holderPctByWallet.get(row.wallet) ?? 0));
  }
  const bundledPct = [...byCluster.values()].reduce((m, n) => Math.max(m, n), 0);
  return { freshCount, maxSameSource, bundledPct };
}

export async function analyseHolders(opts: {
  helius: HeliusProvider;
  holders: RugCheckHolder[];
  cached: Map<string, { walletAgeDays: number | null; fundingSource: string | null; checkedAt: Date }>;
  insiderGroups: Array<{ id: string; wallets: string[] }>;
  freshMaxAgeDays: number;
  now?: Date;
  lookup?: (address: string) => Promise<HeliusFirstTx | null | "unavailable">;
}): Promise<WalletAnalysis> {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const reuseBefore = new Date(nowMs - 24 * 60 * 60 * 1000);
  const owners = [...new Set(opts.holders.filter((h) => !h.isLp).map((h) => h.owner))].slice(0, 20);
  const lookup =
    opts.lookup ??
    (async (address: string) => {
      const res = await opts.helius.getFirstTransaction(address);
      if (!res.ok) return "unavailable" as const;
      return res.data;
    });

  let unverified = !opts.helius.isConfigured() || owners.length === 0;
  const rows: WalletAnalysisRow[] = await Promise.all(
    owners.map(async (wallet) => {
      const cached = opts.cached.get(wallet);
      let age: number | null = cached && cached.checkedAt >= reuseBefore ? cached.walletAgeDays : null;
      let funding = cached && cached.checkedAt >= reuseBefore ? cached.fundingSource : null;
      if (!(cached && cached.checkedAt >= reuseBefore)) {
        const first = await lookup(wallet);
        if (first === "unavailable") unverified = true;
        else if (first) {
          age = ageDays(first.timestamp, nowMs);
          funding = first.fundingSource;
        }
      }
      if (age === null && opts.helius.isConfigured()) unverified = true;
      return {
        wallet,
        walletAgeDays: age,
        isFresh: age === null ? null : age <= opts.freshMaxAgeDays,
        fundingSource: funding,
        clusterId: null,
        isBundlerFlag: false,
      };
    }),
  );

  const clusters = assignClusters(rows, opts.insiderGroups);
  for (const row of rows) {
    row.clusterId = clusters.get(row.wallet) ?? null;
    row.isBundlerFlag = Boolean(row.clusterId);
  }
  const pct = new Map(opts.holders.map((h) => [h.owner, h.pct ?? 0]));
  const summary = summariseWallets(rows, pct);
  return { rows, ...summary, unverified };
}
