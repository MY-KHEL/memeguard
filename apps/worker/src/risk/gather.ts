import { and, desc, eq, gte } from "drizzle-orm";
import { evaluateRisk, ok, riskConfig, unavailable, type RiskEvaluation, type RiskInputs } from "@meme-guard/core";
import { schema, type Database } from "@meme-guard/db";
import { SOL_MINT, type Providers, type RugCheckReport } from "@meme-guard/providers";
import { creatorRugCount, isLiquidityCollapsed, nextPeak } from "./creators";
import { countSameNamePeers } from "./narrative";
import { analyseHolders } from "./wallets";

export const WANTED_KEY = "risk:wanted";

export async function solUsdPrice(providers: Providers): Promise<number | null> {
  const res = await providers.dexscreener.getTokens("solana", [SOL_MINT]);
  if (!res.ok) return null;
  const pair = res.data.find((p) => p.baseToken.address === SOL_MINT || p.quoteToken.address === SOL_MINT);
  const price = pair?.priceUsd ? Number(pair.priceUsd) : null;
  return price && Number.isFinite(price) && price > 0 ? price : null;
}

export function sellAmountRaw(opts: { testAmountUsd: number; priceUsd: number | null; decimals: number | null }): string {
  const decimals = opts.decimals ?? 6;
  if (opts.priceUsd && opts.priceUsd > 0) {
    const tokens = opts.testAmountUsd / opts.priceUsd;
    return String(Math.max(1, Math.floor(tokens * 10 ** decimals)));
  }
  return String(10 ** Math.max(decimals - 2, 0));
}

export async function evaluateMint(
  mint: string,
  deps: { db: Database; providers: Providers; now?: Date },
): Promise<{ evaluation: RiskEvaluation; report: RugCheckReport | null; creatorWallet: string | null; peakLiquidityUsd: number | null; rugDetected: boolean }> {
  const now = deps.now ?? new Date();
  const { db, providers } = deps;
  const [token] = await db.select().from(schema.tokens).where(eq(schema.tokens.mint, mint)).limit(1);
  const [snap] = await db
    .select({ volume5m: schema.tokenSnapshots.volume5m, volume1h: schema.tokenSnapshots.volume1h })
    .from(schema.tokenSnapshots)
    .where(eq(schema.tokenSnapshots.mint, mint))
    .orderBy(desc(schema.tokenSnapshots.ts))
    .limit(1);

  const [rug, asset, candles, solUsd] = await Promise.all([
    providers.rugcheck.getReport(mint),
    providers.helius.getAsset(mint),
    token?.pairAddress ? providers.geckoterminal.getPoolOhlcv(token.pairAddress, "5m", 60) : Promise.resolve(null),
    solUsdPrice(providers),
  ]);

  const rugReport = rug.ok ? rug.data : null;
  const rugErr = rug.ok ? undefined : rug.error;
  const decimals = rugReport?.decimals ?? (asset.ok ? asset.data.decimals : null);
  const priceUsd = token?.latestPrice ? Number(token.latestPrice) : null;
  const sell = await providers.jupiter.simulateSell({
    mint,
    amountRaw: sellAmountRaw({ testAmountUsd: riskConfig.hard_filters.sell_simulation.test_amount_usd, priceUsd, decimals }),
  });
  const sellErr = sell.ok ? undefined : sell.error;

  const cachedWallets = new Map<string, { walletAgeDays: number | null; fundingSource: string | null; checkedAt: Date }>();
  if (rugReport) {
    const existing = await db
      .select()
      .from(schema.walletLinks)
      .where(and(eq(schema.walletLinks.mint, mint), gte(schema.walletLinks.checkedAt, new Date(now.getTime() - 24 * 60 * 60 * 1000))));
    for (const row of existing) {
      cachedWallets.set(row.wallet, { walletAgeDays: row.walletAgeDays, fundingSource: row.fundingSource, checkedAt: row.checkedAt });
    }
  }

  const wallets = rugReport
    ? await analyseHolders({
        helius: providers.helius,
        holders: rugReport.topHolders,
        cached: cachedWallets,
        insiderGroups: [],
        freshMaxAgeDays: riskConfig.hard_filters.fresh_wallet_max_age_days.value,
        now,
      })
    : null;

  if (wallets) {
    for (const row of wallets.rows) {
      await db
        .insert(schema.walletLinks)
        .values({
          mint,
          wallet: row.wallet,
          clusterId: row.clusterId,
          fundingSource: row.fundingSource,
          walletAgeDays: row.walletAgeDays,
          isFresh: row.isFresh,
          isBundlerFlag: row.isBundlerFlag,
          checkedAt: now,
        })
        .onConflictDoUpdate({
          target: [schema.walletLinks.mint, schema.walletLinks.wallet],
          set: {
            clusterId: row.clusterId,
            fundingSource: row.fundingSource,
            walletAgeDays: row.walletAgeDays,
            isFresh: row.isFresh,
            isBundlerFlag: row.isBundlerFlag,
            checkedAt: now,
          },
        });
    }
  }

  let creatorRugs = 0;
  const creatorWallet = rugReport?.creator ?? token?.creatorWallet ?? null;
  if (creatorWallet) {
    const [creator] = await db.select().from(schema.creators).where(eq(schema.creators.wallet, creatorWallet)).limit(1);
    creatorRugs = creator?.tokensRugged ?? 0;
  }

  const latestLiq = token?.latestLiquidityUsd ? Number(token.latestLiquidityUsd) : (rugReport?.liquidityUsd ?? null);
  const peak = nextPeak(token?.peakLiquidityUsd ? Number(token.peakLiquidityUsd) : null, latestLiq);
  const collapsed = isLiquidityCollapsed(peak, latestLiq);
  const ruggedFlag = Boolean(rugReport?.rugged);
  creatorRugs = creatorRugCount({ recordedRugs: creatorRugs, ruggedFlag, collapsedHere: collapsed && Boolean(creatorWallet) });

  if (creatorWallet) {
    await db
      .insert(schema.creators)
      .values({
        wallet: creatorWallet,
        tokensLaunched: rugReport?.creatorTokenCount ?? 1,
        tokensRugged: creatorRugs,
        lastChecked: now,
      })
      .onConflictDoUpdate({
        target: schema.creators.wallet,
        set: {
          tokensLaunched: rugReport?.creatorTokenCount ?? 1,
          tokensRugged: creatorRugs,
          lastChecked: now,
        },
      });
  }

  const mintAuth = rugReport ? ok(rugReport.mintAuthority) : asset.ok ? ok(asset.data.mintAuthority) : unavailable(rug.source, "authorities unavailable");
  const freezeAuth = rugReport ? ok(rugReport.freezeAuthority) : asset.ok ? ok(asset.data.freezeAuthority) : unavailable(rug.source, "authorities unavailable");
  const onCurve = rugReport ? ok(rugReport.onBondingCurve) : unavailable(rug.source, rugErr ?? "bonding curve unknown");

  const money = (raw: string | null | undefined): number | null => {
    if (raw === null || raw === undefined || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  const inputs: RiskInputs = {
    mintAuthority: mintAuth,
    freezeAuthority: freezeAuth,
    lpLockedPct: rugReport ? ok(rugReport.lpLockedPct) : unavailable(rug.source, rugErr),
    onBondingCurve: onCurve,
    sellSimulation: sell.ok ? ok(sell.data) : unavailable(sell.source, sellErr),
    largestNonLpHolderPct: rugReport ? ok(rugReport.largestNonLpHolderPct) : unavailable(rug.source, rugErr),
    freshWalletsInTop20: wallets && !wallets.unverified ? ok(wallets.freshCount) : unavailable("helius", "wallet ages unavailable"),
    sameSourceFundedTopHolders: wallets && !wallets.unverified ? ok(wallets.maxSameSource) : unavailable("helius", "funding sources unavailable"),
    bundledClusterSupplyPct: rugReport ? ok(Math.max(rugReport.bundledClusterSupplyPct, wallets?.bundledPct ?? 0)) : unavailable(rug.source, rugErr),
    creatorPriorRugs: creatorWallet ? ok(creatorRugs) : unavailable("creators", "creator unknown"),
    candles: candles?.ok ? ok(candles.data) : unavailable("geckoterminal", candles && !candles.ok ? candles.error : "no pair address"),
    volume24hUsd: ok(money(token?.latestVolume24h)),
    volume5mUsd: ok(money(snap?.volume5m)),
    volume1hUsd: ok(money(snap?.volume1h)),
    marketCapUsd: ok(token?.latestMarketCap ? Number(token.latestMarketCap) : null),
    holders: rugReport ? ok(rugReport.holders) : unavailable(rug.source, rugErr),
    liquidityUsd: ok(latestLiq),
    solUsd: solUsd ? ok(solUsd) : unavailable("dexscreener", "SOL price unavailable"),
    top5Pct: rugReport ? ok(rugReport.top5Pct) : unavailable(rug.source, rugErr),
    top10Pct: rugReport ? ok(rugReport.top10Pct) : unavailable(rug.source, rugErr),
    ageHours: ok(
      token?.createdAt
        ? (now.getTime() - token.createdAt.getTime()) / 3_600_000
        : token?.firstSeenAt
          ? (now.getTime() - token.firstSeenAt.getTime()) / 3_600_000
          : null,
    ),
    feesPaidSol: unavailable("none", "no fee source"),
    devBoughtMcapPct: unavailable("helius", "creator swaps not checked"),
    devSold: unavailable("helius", "creator swaps not checked"),
    sameNamePeers: unavailable("tokens", "name and symbol unknown"),
  };

  const peers = await countSameNamePeers(
    db,
    mint,
    token?.name ?? null,
    token?.symbol ?? null,
    new Date(now.getTime() - riskConfig.scoring.factors.narrative_crowding.window_hours * 3_600_000),
  );
  if (peers !== null) inputs.sameNamePeers = ok(peers);

  if (creatorWallet) {
    const swaps = await providers.helius.getSwaps(creatorWallet, mint);
    if (swaps.ok) {
      inputs.devSold = ok(swaps.data.some((s) => s.side === "sell"));
      inputs.devBoughtMcapPct = ok(swaps.data.some((s) => s.side === "buy") ? 5 : 0);
    } else if (swaps.reason !== "not_configured") {
      inputs.devSold = unavailable("helius", swaps.error);
      inputs.devBoughtMcapPct = unavailable("helius", swaps.error);
    }
  }

  return {
    evaluation: evaluateRisk(inputs, riskConfig, now),
    report: rugReport,
    creatorWallet,
    peakLiquidityUsd: peak,
    rugDetected: collapsed || ruggedFlag,
  };
}
