import { sql } from "drizzle-orm";
import { tradeCandidatesResponseSchema, type TradeCandidate } from "@meme-guard/shared-types";
import { tradingConfig } from "@meme-guard/trading";
import { getDb } from "./db";
import { logger } from "./logger";

const QUERY_TIMEOUT_MS = 8_000;

function emptyList(): { items: TradeCandidate[]; generatedAt: string } {
  return tradeCandidatesResponseSchema.parse({ items: [], generatedAt: new Date().toISOString() });
}

export async function loadTradeCandidates(): Promise<{ items: TradeCandidate[]; generatedAt: string }> {
  const maxAgeMinutes = tradingConfig.discipline.max_report_age_minutes;
  try {
    const rows = await Promise.race([
      getDb().db.execute<{
        mint: string;
        symbol: string | null;
        name: string | null;
        image_url: string | null;
        latest_price: string | null;
        latest_market_cap: string | null;
        latest_liquidity_usd: string | null;
        latest_volume_24h: string | null;
        volume_1h: string | null;
        score: number;
        ts: Date;
        score_breakdown: { band?: "LOWER_RISK" | "MEDIUM" | "HIGH"; reasons?: Array<{ result: string; rule: string; detail?: string }> };
      }>(sql`
        with latest_pass as (
          select distinct on (mint) mint, score, ts, score_breakdown
          from risk_reports
          where verdict = 'PASS'
            and score is not null
            and ts > now() - make_interval(mins => ${maxAgeMinutes})
          order by mint, ts desc
        )
        select t.mint, t.symbol, t.name, t.image_url, t.latest_price, t.latest_market_cap, t.latest_liquidity_usd, t.latest_volume_24h,
               null::numeric as volume_1h,
               r.score, r.ts, r.score_breakdown
        from latest_pass r
        join tokens t on t.mint = r.mint
        order by r.score desc, r.ts desc
        limit 100
      `),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`trade candidates timed out after ${QUERY_TIMEOUT_MS}ms`)), QUERY_TIMEOUT_MS);
      }),
    ]);

    const items = [...rows].map((row) => {
      const band = row.score_breakdown?.band ?? (row.score >= 75 ? "LOWER_RISK" : row.score >= 50 ? "MEDIUM" : "HIGH");
      const failed = (row.score_breakdown?.reasons ?? []).filter((r: { result: string; rule: string; detail?: string }) => r.result !== "pass");
      const summary = failed[0]?.detail ?? failed[0]?.rule ?? "Passed every hard filter. Risk-reduced, not risk-free.";
      return {
        mint: row.mint,
        symbol: row.symbol,
        name: row.name,
        imageUrl: row.image_url,
        score: row.score,
        band,
        marketCapUsd: row.latest_market_cap === null ? null : Number(row.latest_market_cap),
        liquidityUsd: row.latest_liquidity_usd === null ? null : Number(row.latest_liquidity_usd),
        volume24hUsd: row.latest_volume_24h === null ? null : Number(row.latest_volume_24h),
        volume1hUsd: row.volume_1h === null ? null : Number(row.volume_1h),
        priceUsd: row.latest_price === null ? null : Number(row.latest_price),
        summary,
        evaluatedAt: new Date(row.ts).toISOString(),
      };
    });

    return tradeCandidatesResponseSchema.parse({ items, generatedAt: new Date().toISOString() });
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, "trade candidates query failed");
    return emptyList();
  }
}
