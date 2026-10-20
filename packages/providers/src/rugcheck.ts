import { z } from "zod";
import { createProviderClient, type ProviderClient } from "./client";
import { succeed, type ProviderDeps, type ProviderResult } from "./types";

/**
 * RugCheck public report API. Docs: https://api.rugcheck.xyz/swagger/index.html
 * GET /v1/tokens/{mint}/report is unauthenticated. A key is optional and only
 * required for paid refresh. Response shape probed live on 2026-10-03.
 */

export const RUGCHECK_BASE_URL = "https://api.rugcheck.xyz";
const LIMIT_PER_MINUTE = 30;

const holderSchema = z
  .object({
    address: z.string(),
    owner: z.string().nullable().optional(),
    pct: z.number().nullable().optional(),
    insider: z.boolean().nullable().optional(),
    uiAmount: z.number().nullable().optional(),
  })
  .passthrough();

const marketSchema = z
  .object({
    pubkey: z.string().optional(),
    marketType: z.string().nullable().optional(),
    liquidityA: z.string().nullable().optional(),
    liquidityB: z.string().nullable().optional(),
    lp: z
      .object({
        lpLockedPct: z.number().nullable().optional(),
        quoteUSD: z.number().nullable().optional(),
        baseUSD: z.number().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

const insiderNetworkSchema = z
  .object({
    id: z.string(),
    size: z.number().nullable().optional(),
    tokenAmount: z.union([z.number(), z.string()]).nullable().optional(),
    currentHolding: z.union([z.number(), z.string()]).nullable().optional(),
    activeAccounts: z.number().nullable().optional(),
  })
  .passthrough();

const reportSchema = z
  .object({
    mint: z.string(),
    creator: z.string().nullable().optional(),
    freezeAuthority: z.unknown().optional(),
    mintAuthority: z.unknown().optional(),
    token: z
      .object({
        mintAuthority: z.unknown().optional(),
        freezeAuthority: z.unknown().optional(),
        decimals: z.number().nullable().optional(),
        supply: z.union([z.number(), z.string()]).nullable().optional(),
      })
      .passthrough()
      .optional(),
    topHolders: z.array(holderSchema).nullish(),
    markets: z.array(marketSchema).nullish(),
    totalMarketLiquidity: z.number().nullable().optional(),
    totalHolders: z.number().nullable().optional(),
    rugged: z.boolean().optional(),
    score: z.number().nullable().optional(),
    risks: z.array(z.object({ name: z.string(), value: z.string().nullable().optional(), description: z.string().optional(), level: z.string().optional() }).passthrough()).optional(),
    knownAccounts: z.record(z.string(), z.object({ name: z.string().optional(), type: z.string().optional() }).passthrough()).optional(),
    insiderNetworks: z.array(insiderNetworkSchema).nullable().optional(),
    launchpad: z.object({ name: z.string().optional(), platform: z.string().optional() }).passthrough().nullable().optional(),
    creatorTokens: z.array(z.unknown()).nullable().optional(),
  })
  .passthrough();

export interface RugCheckHolder {
  tokenAccount: string;
  owner: string;
  pct: number | null;
  uiAmount: number | null;
  isLp: boolean;
}

export interface RugCheckCluster {
  id: string;
  accounts: number;
  supplyPct: number | null;
}

export interface RugCheckReport {
  mint: string;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  decimals: number | null;
  creator: string | null;
  creatorTokenCount: number | null;
  rugged: boolean;
  lpLockedPct: number | null;
  onBondingCurve: boolean;
  launchpad: string | null;
  liquidityUsd: number | null;
  holders: number | null;
  topHolders: RugCheckHolder[];
  largestNonLpHolderPct: number | null;
  top5Pct: number | null;
  top10Pct: number | null;
  clusters: RugCheckCluster[];
  bundledClusterSupplyPct: number;
  rawRisks: Array<{ name: string; value: string | null; description?: string; level?: string }>;
}

export interface RugCheckProvider {
  getReport(mint: string): Promise<ProviderResult<RugCheckReport>>;
}

const BONDING_MARKET_TYPES = new Set(["pump_fun", "moonshot", "launchlab", "raydium_launchlab"]);
const LP_ACCOUNT_TYPES = new Set(["AMM", "LOCKER"]);

export function isBondingCurveMarket(marketType: string | null | undefined, launchpadPlatform: string | null | undefined): boolean {
  if (marketType && BONDING_MARKET_TYPES.has(marketType)) return true;
  if (marketType === "pump_fun_amm") return false;
  return false;
}

function authority(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.length === 0 ? null : v;
  if (typeof v === "object") return "live";
  return null;
}

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

export function normaliseRugCheckReport(raw: z.infer<typeof reportSchema>): RugCheckReport {
  const known = raw.knownAccounts ?? {};
  const lpAddresses = new Set<string>();
  for (const [addr, meta] of Object.entries(known)) {
    if (meta.type && LP_ACCOUNT_TYPES.has(meta.type)) lpAddresses.add(addr);
  }
  for (const m of raw.markets ?? []) {
    if (m.liquidityA) lpAddresses.add(m.liquidityA);
    if (m.liquidityB) lpAddresses.add(m.liquidityB);
    if (m.pubkey) lpAddresses.add(m.pubkey);
  }

  const topHolders: RugCheckHolder[] = (raw.topHolders ?? []).map((h) => {
    const owner = h.owner ?? h.address;
    const isLp = lpAddresses.has(h.address) || lpAddresses.has(owner) || Boolean(known[owner]?.type && LP_ACCOUNT_TYPES.has(known[owner]!.type!));
    return { tokenAccount: h.address, owner, pct: h.pct ?? null, uiAmount: h.uiAmount ?? null, isLp };
  });

  const nonLp = topHolders.filter((h) => !h.isLp && h.pct !== null);
  const largestNonLpHolderPct = nonLp.reduce<number | null>((max, h) => (max === null || (h.pct ?? 0) > max ? (h.pct ?? null) : max), null);
  const top5Pct = sumPct(nonLp.slice(0, 5));
  const top10Pct = sumPct(nonLp.slice(0, 10));

  const supplyRaw = num(raw.token?.supply);
  const clusters: RugCheckCluster[] = (raw.insiderNetworks ?? []).map((n) => {
    const holding = num(n.currentHolding) ?? num(n.tokenAmount);
    const supplyPct = holding !== null && supplyRaw && supplyRaw > 0 ? (holding / supplyRaw) * 100 : null;
    return { id: n.id, accounts: n.activeAccounts ?? n.size ?? 0, supplyPct };
  });
  const bundledClusterSupplyPct = clusters.reduce((max, c) => Math.max(max, c.supplyPct ?? 0), 0);

  const markets = raw.markets ?? [];
  const best = [...markets].sort((a, b) => (b.lp?.lpLockedPct ?? 0) - (a.lp?.lpLockedPct ?? 0))[0];
  const onBondingCurve = markets.some((m) => isBondingCurveMarket(m.marketType, raw.launchpad?.platform)) && !markets.some((m) => m.marketType === "pump_fun_amm");

  return {
    mint: raw.mint,
    mintAuthority: authority(raw.mintAuthority ?? raw.token?.mintAuthority),
    freezeAuthority: authority(raw.freezeAuthority ?? raw.token?.freezeAuthority),
    decimals: raw.token?.decimals ?? null,
    creator: raw.creator ?? null,
    creatorTokenCount: Array.isArray(raw.creatorTokens) ? raw.creatorTokens.length : null,
    rugged: Boolean(raw.rugged),
    lpLockedPct: best?.lp?.lpLockedPct ?? null,
    onBondingCurve,
    launchpad: raw.launchpad?.platform ?? raw.launchpad?.name ?? null,
    liquidityUsd: raw.totalMarketLiquidity ?? null,
    holders: raw.totalHolders ?? null,
    topHolders,
    largestNonLpHolderPct,
    top5Pct,
    top10Pct,
    clusters,
    bundledClusterSupplyPct,
    rawRisks: (raw.risks ?? []).map((r) => ({ name: r.name, value: r.value ?? null, description: r.description, level: r.level })),
  };
}

function sumPct(holders: RugCheckHolder[]): number | null {
  if (holders.length === 0) return null;
  return holders.reduce((s, h) => s + (h.pct ?? 0), 0);
}

export function createRugCheck(deps: ProviderDeps, client?: ProviderClient): RugCheckProvider {
  const http =
    client ??
    createProviderClient(
      {
        name: "rugcheck",
        baseUrl: deps.env.RUGCHECK_BASE_URL ?? RUGCHECK_BASE_URL,
        rateLimitPerMinute: LIMIT_PER_MINUTE,
        timeoutMs: 10_000,
        defaultHeaders: deps.env.RUGCHECK_API_KEY ? { "X-API-KEY": deps.env.RUGCHECK_API_KEY } : undefined,
      },
      deps,
    );

  return {
    async getReport(mint) {
      const res = await http.request({
        path: `/v1/tokens/${mint}/report`,
        schema: reportSchema,
        cache: { parts: ["report", mint], ttlSeconds: 120 },
        notFoundStatuses: [404],
      });
      if (!res.ok) return res;
      return succeed("rugcheck", normaliseRugCheckReport(res.data), res.fromCache);
    },
  };
}
