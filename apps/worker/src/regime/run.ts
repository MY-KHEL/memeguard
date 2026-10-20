import { desc, sql } from "drizzle-orm";
import { schema, type Database } from "@meme-guard/db";
import { classifyRegime, dailyBarsFromOhlc, riskConfig, trendFromDaily, type MajorTrend } from "@meme-guard/core";
import type { Providers } from "@meme-guard/providers";
import type { JobStats } from "@meme-guard/shared-types";
import type { Logger } from "../logger";
import type { LiveBus } from "../live/bus";

export function createRegimeWorker(deps: {
  db: Database;
  providers: Providers;
  bus: LiveBus;
  log: Logger;
  intervalMs: number;
}) {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  const stats: JobStats = { lastRunAt: null, lastCycleMs: null, lastError: null };

  async function majorTrend(id: "bitcoin" | "ethereum" | "solana"): Promise<MajorTrend> {
    const res = await deps.providers.coingecko.getOhlc(id, 14);
    if (!res.ok) return "flat";
    const daily = dailyBarsFromOhlc(res.data).slice(-riskConfig.regime.lookback_days);
    return trendFromDaily(daily, riskConfig.regime.hhhl_min_pairs);
  }

  async function memeVolumeUsd(): Promise<number> {
    const [row] = await deps.db.execute<{ v: string | null }>(sql`
      select coalesce(sum(latest_volume_24h), 0)::text as v from tokens where last_snapshot_at is not null
    `);
    const n = Number(row?.v ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  async function avgPeakMcap(): Promise<number | null> {
    const [row] = await deps.db.execute<{ v: string | null }>(sql`
      select avg(latest_market_cap)::text as v
      from tokens
      where first_seen_at > now() - interval '48 hours' and latest_market_cap is not null
    `);
    const n = Number(row?.v ?? NaN);
    return Number.isFinite(n) ? n : null;
  }

  async function tick() {
    const started = performance.now();
    try {
      const [btc, eth, sol, volumeNow, avgPeak] = await Promise.all([
        majorTrend("bitcoin"),
        majorTrend("ethereum"),
        majorTrend("solana"),
        memeVolumeUsd(),
        avgPeakMcap(),
      ]);
      const [prev] = await deps.db.select().from(schema.regimeSnapshots).orderBy(desc(schema.regimeSnapshots.ts)).limit(1);
      const prevVol = prev?.memecoinVolumeIndex !== null && prev?.memecoinVolumeIndex !== undefined ? Number(prev.memecoinVolumeIndex) : null;
      const volumeRatio = prevVol !== null && prevVol > 0 ? volumeNow / prevVol : null;
      const decision = classifyRegime({ btc, eth, sol, volumeRatio, avgPeakMcap: avgPeak });
      await deps.db.insert(schema.regimeSnapshots).values({
        btcTrend: decision.btcTrend,
        ethTrend: decision.ethTrend,
        solTrend: decision.solTrend,
        memecoinVolumeIndex: String(volumeNow),
        avgPeakMcap: avgPeak === null ? null : String(avgPeak),
        regime: decision.regime,
      });
      await deps.bus.publish({ type: "regime.update", regime: decision.regime, ts: new Date().toISOString() });
      stats.lastError = null;
      deps.log.info({ regime: decision.regime, btc, eth, sol, volumeRatio, avgPeak }, "regime snapshot stored");
    } catch (error) {
      stats.lastError = error instanceof Error ? error.message : String(error);
      deps.log.warn({ err: stats.lastError }, "regime tick failed");
    } finally {
      stats.lastRunAt = new Date().toISOString();
      stats.lastCycleMs = Math.round(performance.now() - started);
    }
  }

  return {
    stats: () => stats,
    start() {
      stopped = false;
      deps.log.info({ intervalMs: deps.intervalMs }, "regime worker starting");
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
