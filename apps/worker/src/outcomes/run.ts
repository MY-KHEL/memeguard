import { eq, sql } from "drizzle-orm";
import { schema, type Database } from "@meme-guard/db";
import { riskConfig } from "@meme-guard/core";
import type { JobStats } from "@meme-guard/shared-types";
import type { Logger } from "../logger";

export function createOutcomeTracker(deps: { db: Database; log: Logger; intervalMs: number }) {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  const stats: JobStats = { lastRunAt: null, lastCycleMs: null, lastError: null };

  async function tick() {
    const started = performance.now();
    try {
      let written = 0;
      for (const offset of riskConfig.calibration.offsets_minutes) {
        const due = await deps.db.execute<{
          id: number;
          mint: string;
          ts: Date;
          base_price: string | null;
          base_mcap: string | null;
        }>(sql`
          select r.id, r.mint, r.ts,
                 (
                   select s.price::text from token_snapshots s
                   where s.mint = r.mint and s.ts <= r.ts
                   order by s.ts desc limit 1
                 ) as base_price,
                 (
                   select s.market_cap::text from token_snapshots s
                   where s.mint = r.mint and s.ts <= r.ts
                   order by s.ts desc limit 1
                 ) as base_mcap
          from risk_reports r
          where r.ts <= now() - (${offset} * interval '1 minute')
            and r.ts > now() - interval '36 hours'
            and not exists (
              select 1 from alert_outcomes o
              where o.mint = r.mint and o.risk_report_id = r.id and o.offset_minutes = ${offset}
            )
          order by r.ts asc
          limit 40
        `);
        for (const row of due) {
          const [token] = await deps.db.select().from(schema.tokens).where(eq(schema.tokens.mint, row.mint)).limit(1);
          const baseTs = row.ts instanceof Date ? row.ts : new Date(row.ts);
          if (Number.isNaN(baseTs.getTime())) continue;
          await deps.db.insert(schema.alertOutcomes).values({
            mint: row.mint,
            riskReportId: row.id,
            baseTs,
            basePrice: row.base_price,
            baseMarketCap: row.base_mcap,
            offsetMinutes: offset,
            price: token?.latestPrice ?? null,
            marketCap: token?.latestMarketCap ?? null,
          });
          written += 1;
        }
      }
      stats.lastError = null;
      if (written > 0) deps.log.info({ written }, "outcome snapshots written");
    } catch (error) {
      stats.lastError = error instanceof Error ? error.message : String(error);
      deps.log.warn({ err: stats.lastError }, "outcome tick failed");
    } finally {
      stats.lastRunAt = new Date().toISOString();
      stats.lastCycleMs = Math.round(performance.now() - started);
    }
  }

  return {
    stats: () => stats,
    start() {
      stopped = false;
      deps.log.info({ intervalMs: deps.intervalMs, offsets: riskConfig.calibration.offsets_minutes }, "outcome tracker starting");
      const loop = async () => {
        if (stopped) return;
        await tick();
        if (!stopped) timer = setTimeout(() => void loop(), deps.intervalMs);
      };
      void loop();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
