import { and, desc, eq, sql } from "drizzle-orm";
import { schema } from "@meme-guard/db";
import { SOL_MINT } from "@meme-guard/providers";
import {
  checkLimits,
  fillBuy,
  fillSell,
  applyAddOnBuy,
  resolveLimits,
  tradingConfig,
  type LimitCheck,
  type LimitOverrides,
} from "@meme-guard/trading";
import type { ExitPlan, PaperBuyInput, PaperSellInput, ScoreBand } from "@meme-guard/shared-types";
import { getDb } from "@/lib/db";
import { getProviders } from "@/lib/providers";
import { lockStatus, num, parseSettings, utcDate, type UserSettings } from "@/lib/auth/user";
import { latestRegime } from "@/lib/regime";
import { publishLive } from "./publish";

const LAMPORTS = 1_000_000_000;

export function asNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function latestRisk(mint: string) {
  const { db } = getDb();
  const [row] = await db
    .select()
    .from(schema.riskReports)
    .where(eq(schema.riskReports.mint, mint))
    .orderBy(desc(schema.riskReports.ts))
    .limit(1);
  return row ?? null;
}

export function reportTradable(row: typeof schema.riskReports.$inferSelect | null, now = new Date()): { ok: true; band: ScoreBand | null } | { ok: false; rule: "not_tradable" | "report_stale" } {
  if (!row || row.verdict !== "PASS" || row.score === null) return { ok: false, rule: "not_tradable" };
  const ageMin = (now.getTime() - row.ts.getTime()) / 60_000;
  if (ageMin > tradingConfig.discipline.max_report_age_minutes) return { ok: false, rule: "report_stale" };
  const breakdown = row.scoreBreakdown as { band?: ScoreBand };
  return { ok: true, band: breakdown.band ?? null };
}

export async function tokenMarket(mint: string) {
  const { db } = getDb();
  const [row] = await db.select().from(schema.tokens).where(eq(schema.tokens.mint, mint)).limit(1);
  return row ?? null;
}

export async function loadDecimals(mint: string): Promise<number | null> {
  const asset = await getProviders().helius.getAsset(mint);
  if (asset.ok && asset.data.decimals !== null) return asset.data.decimals;
  return null;
}

export async function quoteBuy(mint: string, sizeSol: number) {
  const raw = String(Math.round(sizeSol * LAMPORTS));
  return getProviders().jupiter.quoteSwap({
    inputMint: SOL_MINT,
    outputMint: mint,
    amountRaw: raw,
    slippageBps: tradingConfig.quote.slippage_bps,
  });
}

export async function quoteSell(mint: string, tokenAmount: number, decimals: number) {
  const raw = String(Math.round(tokenAmount * 10 ** decimals));
  return getProviders().jupiter.quoteSwap({
    inputMint: mint,
    outputMint: SOL_MINT,
    amountRaw: raw,
    slippageBps: tradingConfig.quote.slippage_bps,
  });
}

export async function openPositionState(userId: string) {
  const { db } = getDb();
  const rows = await db
    .select()
    .from(schema.positions)
    .where(and(eq(schema.positions.userId, userId), eq(schema.positions.status, "open"), eq(schema.positions.mode, "paper")));
  return rows.map((p) => ({ mint: p.mint, remainingCostSol: num(p.remainingCostSol) }));
}

export async function equityFor(userId: string, paperBalanceSol: number, solUsd: number | null): Promise<number> {
  const { db } = getDb();
  const rows = await db
    .select({
      remainingTokens: schema.positions.remainingTokens,
      remainingCostSol: schema.positions.remainingCostSol,
      priceUsd: schema.tokens.latestPrice,
    })
    .from(schema.positions)
    .leftJoin(schema.tokens, eq(schema.tokens.mint, schema.positions.mint))
    .where(and(eq(schema.positions.userId, userId), eq(schema.positions.status, "open"), eq(schema.positions.mode, "paper")));
  let marks = 0;
  for (const r of rows) {
    const tokens = num(r.remainingTokens);
    const cost = num(r.remainingCostSol);
    const px = asNumber(r.priceUsd);
    if (px !== null && solUsd && solUsd > 0) marks += tokens * (px / solUsd);
    else marks += cost;
  }
  return paperBalanceSol + marks;
}

export async function solUsdPrice(): Promise<number | null> {
  const res = await getProviders().dexscreener.getTokens("solana", [SOL_MINT]);
  if (!res.ok || res.data.length === 0) return null;
  const px = res.data.find((p) => p.priceUsd)?.priceUsd;
  const n = px === undefined || px === null ? NaN : Number(px);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function buildLimitCheck(opts: {
  user: typeof schema.users.$inferSelect;
  settings: UserSettings;
  mint: string;
  sizeSol: number;
  marketCapUsd: number | null;
  band: ScoreBand | null;
  thesis?: string;
  sellReason?: string;
  priceChange1hPct?: number | null;
  fomoConfirmed?: boolean;
}): Promise<LimitCheck> {
  const solUsd = await solUsdPrice();
  const paper = num(opts.user.paperBalanceSol);
  const equity = await equityFor(opts.user.id, paper, solUsd);
  const locks = lockStatus(opts.settings, equity);
  return checkLimits(
    {
      paperBalanceSol: paper,
      equitySol: equity,
      dayStartEquitySol: locks.dayStartEquitySol,
      openPositions: await openPositionState(opts.user.id),
      lastLosingTradeAt: opts.settings.lastLosingTradeAt ? new Date(opts.settings.lastLosingTradeAt) : null,
      now: new Date(),
      regime: await latestRegime(),
    },
    {
      mint: opts.mint,
      sizeSol: opts.sizeSol,
      marketCapUsd: opts.marketCapUsd,
      scoreBand: opts.band,
      thesis: opts.thesis,
      sellReason: opts.sellReason,
      priceChange1hPct: opts.priceChange1hPct,
      fomoConfirmed: opts.fomoConfirmed,
    },
    opts.settings.limits,
  );
}

export async function paperBuy(user: typeof schema.users.$inferSelect, settings: UserSettings, input: PaperBuyInput) {
  const report = reportTradable(await latestRisk(input.mint));
  if (!report.ok) return { ok: false as const, status: 403, error: report.rule };
  const token = await tokenMarket(input.mint);
  if (!token) return { ok: false as const, status: 404, error: "token not tracked" };

  const limits = await buildLimitCheck({
    user,
    settings,
    mint: input.mint,
    sizeSol: input.sizeSol,
    marketCapUsd: asNumber(token.latestMarketCap),
    band: report.band,
    thesis: input.thesis,
    sellReason: input.sellReason,
    priceChange1hPct: asNumber(token.latestPriceChange1h),
    fomoConfirmed: input.fomoConfirmed,
  });
  if (!limits.ok) {
    if (limits.applied.dailyLossLocked) {
      const { db } = getDb();
      await db.insert(schema.limitEvents).values({ userId: user.id, type: "daily_loss", detail: { source: "paper_buy" } });
    }
    return { ok: false as const, status: 403, error: "limit", violations: limits.violations, applied: limits.applied };
  }

  const quote = await quoteBuy(input.mint, input.sizeSol);
  if (!quote.ok) return { ok: false as const, status: 503, error: "quote unavailable" };
  if (!quote.data.quoted || !quote.data.outAmountLamports) return { ok: false as const, status: 403, error: "no route" };
  if (quote.data.priceImpactPct !== null && quote.data.priceImpactPct > tradingConfig.quote.max_price_impact_pct) {
    return { ok: false as const, status: 403, error: "price impact", violations: [{ rule: "price_impact", value: quote.data.priceImpactPct, threshold: tradingConfig.quote.max_price_impact_pct, result: "fail" as const }] };
  }

  const decimals = await loadDecimals(input.mint);
  if (decimals === null) return { ok: false as const, status: 403, error: "decimals unverified" };
  const tokensReceived = Number(quote.data.outAmountLamports) / 10 ** decimals;
  const fill = fillBuy({ solIn: input.sizeSol, tokensOut: tokensReceived, priceImpactPct: quote.data.priceImpactPct });
  const entryUsd = asNumber(token.latestPrice) ?? 0;
  const exitPlan: ExitPlan = {
    sellReason: input.sellReason.trim(),
    stopPct: input.stopPct,
    stopPriceUsd: entryUsd > 0 ? entryUsd * (1 - input.stopPct / 100) : null,
    ladder: input.ladder,
    fomoConfirmed: input.fomoConfirmed,
  };

  const { db } = getDb();
  const result = await db.transaction(async (tx) => {
    const locked = await tx.execute<{ paper_balance_sol: string }>(sql`
      select paper_balance_sol from users where id = ${user.id}::uuid for update
    `);
    const cash = num([...locked][0]?.paper_balance_sol);
    if (cash < input.sizeSol) return { ok: false as const, error: "insufficient_balance" };
    const nextCash = cash - input.sizeSol;
    const day = utcDate();
    const nextSettings = nextDailySettings(settings, cash + fill.solSpent, day);

    await tx
      .update(schema.users)
      .set({ paperBalanceSol: String(nextCash), settings: nextSettings })
      .where(eq(schema.users.id, user.id));

    const [open] = await tx
      .select()
      .from(schema.positions)
      .where(and(eq(schema.positions.userId, user.id), eq(schema.positions.mint, input.mint), eq(schema.positions.status, "open"), eq(schema.positions.mode, "paper")))
      .limit(1);

    let positionId: string;
    if (open) {
      const added = applyAddOnBuy(num(open.remainingTokens), num(open.remainingCostSol), fill);
      await tx
        .update(schema.positions)
        .set({
          remainingTokens: String(added.remainingTokens),
          remainingCostSol: String(added.remainingCostSol),
          sizeSol: String(num(open.sizeSol) + fill.solSpent),
          entryPrice: String(entryUsd || num(open.entryPrice)),
          tokenDecimals: decimals,
        })
        .where(eq(schema.positions.id, open.id));
      positionId = open.id;
    } else {
      const inserted = await tx
        .insert(schema.positions)
        .values({
          userId: user.id,
          mint: input.mint,
          mode: "paper",
          entryPrice: String(entryUsd),
          sizeSol: String(fill.solSpent),
          status: "open",
          thesis: input.thesis.trim(),
          exitPlan,
          remainingTokens: String(fill.tokensReceived),
          remainingCostSol: String(fill.solSpent),
          tokenDecimals: decimals,
        })
        .returning({ id: schema.positions.id });
      positionId = inserted[0]!.id;
    }

    await tx.insert(schema.trades).values({
      positionId,
      side: "buy",
      price: String(fill.fillPriceSol),
      amount: String(fill.tokensReceived),
      slippagePct: fill.priceImpactPct === null ? null : String(fill.priceImpactPct),
    });
    return { ok: true as const, positionId, fill, paperBalanceSol: nextCash };
  });

  if (!result.ok) return { ok: false as const, status: 403, error: result.error };
  await publishLive({ type: "position.update", userId: user.id, positionId: result.positionId, ts: new Date().toISOString() });
  return { ok: true as const, positionId: result.positionId, fill: result.fill, paperBalanceSol: result.paperBalanceSol };
}

export async function paperSell(user: typeof schema.users.$inferSelect, settings: UserSettings, input: PaperSellInput) {
  const { db } = getDb();
  const [pos] = await db
    .select()
    .from(schema.positions)
    .where(and(eq(schema.positions.id, input.positionId), eq(schema.positions.userId, user.id), eq(schema.positions.mode, "paper")))
    .limit(1);
  if (!pos || pos.status !== "open") return { ok: false as const, status: 404, error: "position not open" };
  const remaining = num(pos.remainingTokens);
  const amount = input.close || !input.tokenAmount ? remaining : input.tokenAmount;
  if (!(amount > 0) || amount > remaining + 1e-12) return { ok: false as const, status: 400, error: "invalid amount" };

  const quote = await quoteSell(pos.mint, amount, pos.tokenDecimals);
  if (!quote.ok) return { ok: false as const, status: 503, error: "quote unavailable" };
  if (!quote.data.quoted || !quote.data.outAmountLamports) return { ok: false as const, status: 403, error: "no route" };
  const solOut = Number(quote.data.outAmountLamports) / LAMPORTS;
  const fill = fillSell({ tokensIn: amount, solOut, priceImpactPct: quote.data.priceImpactPct }, remaining, num(pos.remainingCostSol));
  const remainingTokens = remaining - fill.tokensSold;
  const closed = remainingTokens <= 1e-12;

  const result = await db.transaction(async (tx) => {
    const locked = await tx.execute<{ paper_balance_sol: string; settings: unknown }>(sql`
      select paper_balance_sol, settings from users where id = ${user.id}::uuid for update
    `);
    const row = [...locked][0];
    const cash = num(row?.paper_balance_sol);
    const nextCash = cash + fill.solReceived;
    const liveSettings = parseSettings(row?.settings);
    const nextSettings = { ...liveSettings } as UserSettings;
    if (closed && fill.realizedPnlSol < 0) nextSettings.lastLosingTradeAt = new Date().toISOString();
    const day = utcDate();
    nextSettings.dailyLoss = nextDailySettings(liveSettings, cash, day).dailyLoss;

    await tx.update(schema.users).set({ paperBalanceSol: String(nextCash), settings: nextSettings }).where(eq(schema.users.id, user.id));
    await tx
      .update(schema.positions)
      .set({
        remainingTokens: String(closed ? 0 : remainingTokens),
        remainingCostSol: String(closed ? 0 : fill.remainingCostSol),
        status: closed ? "closed" : "open",
        closedAt: closed ? new Date() : null,
      })
      .where(eq(schema.positions.id, pos.id));
    await tx.insert(schema.trades).values({
      positionId: pos.id,
      side: "sell",
      price: String(fill.fillPriceSol),
      amount: String(fill.tokensSold),
      slippagePct: fill.priceImpactPct === null ? null : String(fill.priceImpactPct),
    });
    if (closed) {
      const pct = num(pos.remainingCostSol) > 0 ? (fill.realizedPnlSol / num(pos.remainingCostSol)) * 100 : 0;
      await tx.insert(schema.journalEntries).values({
        userId: user.id,
        positionId: pos.id,
        thesis: pos.thesis,
        outcomeNotes: `Closed paper. Realized ${fill.realizedPnlSol.toFixed(4)} SOL (${pct.toFixed(1)}%). Stops on thin liquidity can slip.`,
      });
    }
    return { nextCash };
  });

  await publishLive({ type: "position.update", userId: user.id, positionId: pos.id, ts: new Date().toISOString() });
  return { ok: true as const, fill, closed, paperBalanceSol: result.nextCash };
}

function nextDailySettings(settings: UserSettings, equityHint: number, day: string): UserSettings {
  const dailyLoss = settings.dailyLoss?.date === day ? settings.dailyLoss : { date: day, startEquitySol: equityHint };
  return { ...settings, dailyLoss };
}

export function overridesFromBody(raw: unknown): LimitOverrides | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  return resolveLimits(raw as LimitOverrides);
}
