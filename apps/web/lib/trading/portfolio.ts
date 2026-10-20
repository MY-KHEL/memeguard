import { desc, eq } from "drizzle-orm";
import { schema } from "@meme-guard/db";
import { applyRegimeToLimits, markPosition, resolveLimits, tradingConfig } from "@meme-guard/trading";
import { latestRegime } from "@/lib/regime";
import { exitPlanSchema, type ExitPlan, type PortfolioResponse, type PositionDto } from "@meme-guard/shared-types";
import { getDb } from "@/lib/db";
import { lockStatus, num, parseSettings, type UserSettings } from "@/lib/auth/user";
import { asNumber, equityFor, solUsdPrice } from "./execute";
import { publishLive } from "./publish";

function planOf(raw: unknown): ExitPlan {
  const parsed = exitPlanSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return {
    sellReason: typeof raw === "object" && raw && "sellReason" in raw ? String((raw as { sellReason: unknown }).sellReason) : "",
    stopPct: tradingConfig.exit_plan.default_stop_pct,
    stopPriceUsd: null,
    ladder: tradingConfig.exit_plan.default_ladder.map((s) => ({ multiple: s.multiple, sellPct: s.sell_pct })),
  };
}

export async function loadPortfolio(user: typeof schema.users.$inferSelect, settings: UserSettings): Promise<PortfolioResponse> {
  const { db } = getDb();
  const solUsd = await solUsdPrice();
  const paper = num(user.paperBalanceSol);
  const equity = await equityFor(user.id, paper, solUsd);
  const locks = lockStatus(settings, equity);
  const rows = await db
    .select({
      position: schema.positions,
      symbol: schema.tokens.symbol,
      name: schema.tokens.name,
      imageUrl: schema.tokens.imageUrl,
      priceUsd: schema.tokens.latestPrice,
    })
    .from(schema.positions)
    .innerJoin(schema.tokens, eq(schema.tokens.mint, schema.positions.mint))
    .where(eq(schema.positions.userId, user.id))
    .orderBy(desc(schema.positions.openedAt));

  const latestReports = await db
    .select({ mint: schema.riskReports.mint, scoreBreakdown: schema.riskReports.scoreBreakdown, ts: schema.riskReports.ts })
    .from(schema.riskReports)
    .orderBy(desc(schema.riskReports.ts));
  const bandByMint = new Map<string, PositionDto["scoreBand"]>();
  for (const r of latestReports) {
    if (bandByMint.has(r.mint)) continue;
    const band = (r.scoreBreakdown as { band?: PositionDto["scoreBand"] }).band ?? null;
    bandByMint.set(r.mint, band);
  }

  const items: PositionDto[] = rows.map(({ position: p, symbol, name, imageUrl, priceUsd }) => {
    const remainingTokens = num(p.remainingTokens);
    const remainingCost = num(p.remainingCostSol);
    const px = asNumber(priceUsd);
    const markSol = px !== null && solUsd && solUsd > 0 ? px / solUsd : null;
    const pnl = markSol !== null ? markPosition(remainingTokens, remainingCost, markSol) : null;
    const plan = planOf(p.exitPlan);
    const entryUsd = num(p.entryPrice);
    const stopHit = p.status === "open" && plan.stopPriceUsd !== null && px !== null && px <= plan.stopPriceUsd;
    const ladderHits = plan.ladder
      .filter((step) => p.status === "open" && px !== null && entryUsd > 0 && px >= entryUsd * step.multiple)
      .map((step) => step.multiple);
    const recheck =
      p.status === "open" &&
      !plan.recheckAckedAt &&
      pnl !== null &&
      pnl.unrealizedPct !== null &&
      pnl.unrealizedPct >= tradingConfig.discipline.recheck_unrealized_pct;
    return {
      id: p.id,
      mint: p.mint,
      symbol,
      name,
      imageUrl,
      mode: p.mode,
      status: p.status,
      thesis: p.thesis,
      exitPlan: plan,
      entryPriceUsd: entryUsd,
      sizeSol: num(p.sizeSol),
      remainingTokens,
      remainingCostSol: remainingCost,
      markPriceUsd: px,
      markValueSol: pnl?.markValueSol ?? null,
      unrealizedPnlSol: pnl?.unrealizedPnlSol ?? null,
      unrealizedPct: pnl?.unrealizedPct ?? null,
      realizedPnlSol: p.status === "closed" ? pnl?.realizedPnlSol ?? null : null,
      scoreBand: bandByMint.get(p.mint) ?? null,
      stopHit,
      ladderHits,
      recheck,
      openedAt: p.openedAt.toISOString(),
      closedAt: p.closedAt ? p.closedAt.toISOString() : null,
    };
  });

  const open = items.filter((i) => i.status === "open");
  const exposureSol = open.reduce((s, i) => s + (i.markValueSol ?? i.remainingCostSol), 0);
  return {
    paperBalanceSol: paper,
    equitySol: equity,
    exposureSol,
    dailyLossLocked: locks.dailyLossLocked,
    cooldownUntil: locks.cooldownUntil,
    limits: applyRegimeToLimits(resolveLimits(settings.limits), await latestRegime()),
    open,
    closed: items.filter((i) => i.status === "closed"),
  };
}

export async function maybeNotifyLevels(userId: string, portfolio: PortfolioResponse): Promise<void> {
  const { db } = getDb();
  for (const pos of portfolio.open) {
    if (pos.stopHit) {
      await insertOnce(db, userId, "stop_hit", `stop:${pos.id}`, { mint: pos.mint, stopPriceUsd: pos.exitPlan.stopPriceUsd });
    }
    for (const multiple of pos.ladderHits) {
      await insertOnce(db, userId, "ladder_hit", `ladder:${pos.id}:${multiple}`, { mint: pos.mint, multiple });
    }
  }
}

async function insertOnce(
  db: ReturnType<typeof getDb>["db"],
  userId: string,
  type: string,
  key: string,
  payload: Record<string, unknown>,
) {
  const inserted = await db
    .insert(schema.notifications)
    .values({
      userId,
      type,
      dedupKey: key,
      payload: {
        title: type === "stop_hit" ? "Stop hit" : "Ladder level",
        body: type === "stop_hit" ? "Thin liquidity can slip." : "A scale-out level was reached.",
        urgent: type === "stop_hit",
        ...payload,
      },
    })
    .onConflictDoNothing()
    .returning({ id: schema.notifications.id });
  const id = inserted[0]?.id;
  if (id) {
    await publishLive({ type: "notification.new", userId, notificationId: id, ts: new Date().toISOString() });
  }
}
