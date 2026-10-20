import { paperPreviewSchema, quotePreviewSchema } from "@meme-guard/shared-types";
import { tradingConfig } from "@meme-guard/trading";
import { jsonError, jsonOk, withErrorBoundary } from "@/lib/api-response";
import { requireUser } from "@/lib/auth/user";
import { asNumber, buildLimitCheck, latestRisk, quoteBuy, quoteSell, reportTradable, tokenMarket, loadDecimals } from "@/lib/trading/execute";
import { eq, and } from "drizzle-orm";
import { schema } from "@meme-guard/db";
import { getDb } from "@/lib/db";
import { num } from "@/lib/auth/user";

export const dynamic = "force-dynamic";

export const POST = withErrorBoundary("POST /api/trade/preview", async (request: Request) => {
  const auth = await requireUser();
  if (!auth.ok) return jsonError(auth.status, auth.error);
  const parsed = paperPreviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "invalid body");
  const { mint, side } = parsed.data;

  if (side === "buy") {
    const sizeSol = parsed.data.sizeSol;
    if (!sizeSol) return jsonError(400, "sizeSol required");
    const report = reportTradable(await latestRisk(mint));
    const token = await tokenMarket(mint);
    const limits = token
      ? await buildLimitCheck({
          user: auth.user,
          settings: auth.settings,
          mint,
          sizeSol,
          marketCapUsd: asNumber(token.latestMarketCap),
          band: report.ok ? report.band : null,
          priceChange1hPct: asNumber(token?.latestPriceChange1h),
          fomoConfirmed: parsed.data.fomoConfirmed,
          thesis: "preview-thesis-placeholder",
          sellReason: "preview-sell-placeholder",
        })
      : null;
    const quote = await quoteBuy(mint, sizeSol);
    const out = quote.ok && quote.data.quoted && quote.data.outAmountLamports ? Number(quote.data.outAmountLamports) : null;
    const decimals = out !== null ? await loadDecimals(mint) : null;
    const tokens = out !== null && decimals !== null ? out / 10 ** decimals : null;
    return jsonOk(
      quotePreviewSchema.parse({
        ok: Boolean(report.ok && quote.ok && quote.data.quoted && limits?.ok),
        mint,
        side,
        sizeSol,
        tokenAmount: tokens,
        expectedOut: tokens,
        fillPriceSol: tokens && tokens > 0 ? sizeSol / tokens : null,
        priceImpactPct: quote.ok ? quote.data.priceImpactPct : null,
        fomo: Boolean(token && (asNumber(token.latestPriceChange1h) ?? 0) >= tradingConfig.discipline.fomo_1h_change_pct),
        violations: [...(report.ok ? [] : [{ rule: report.rule, value: null, threshold: "PASS", result: "fail" as const }]), ...(limits?.violations.filter((v) => v.rule !== "thesis_required" && v.rule !== "sell_reason_required") ?? [])],
        applied: limits?.applied ?? null,
      }),
    );
  }

  const { db } = getDb();
  const [pos] = await db
    .select()
    .from(schema.positions)
    .where(and(eq(schema.positions.userId, auth.user.id), eq(schema.positions.mint, mint), eq(schema.positions.status, "open")))
    .limit(1);
  if (!pos) return jsonError(404, "no open position");
  const tokenAmount = parsed.data.tokenAmount ?? num(pos.remainingTokens);
  const quote = await quoteSell(mint, tokenAmount, pos.tokenDecimals);
  const solOut = quote.ok && quote.data.quoted && quote.data.outAmountLamports ? Number(quote.data.outAmountLamports) / 1_000_000_000 : null;
  return jsonOk(
    quotePreviewSchema.parse({
      ok: Boolean(quote.ok && quote.data.quoted),
      mint,
      side,
      sizeSol: solOut,
      tokenAmount,
      expectedOut: solOut,
      fillPriceSol: solOut !== null && tokenAmount > 0 ? solOut / tokenAmount : null,
      priceImpactPct: quote.ok ? quote.data.priceImpactPct : null,
      fomo: false,
      violations: [],
      applied: null,
    }),
  );
});
