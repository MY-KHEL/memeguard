import { CONFIG_VERSION, type RuleResult } from "@meme-guard/core";
import { eq, sql } from "drizzle-orm";
import { schema, type Database } from "@meme-guard/db";
import type { Providers } from "@meme-guard/providers";
import type { RiskStats } from "@meme-guard/shared-types";
import type Redis from "ioredis";
import { withDbWrite } from "../db-lock";
import type { Logger } from "../logger";
import { cheapGate, type CheapMarket } from "./cheap";
import { evaluateMint, solUsdPrice, WANTED_KEY } from "./gather";

export interface RiskWorkerConfig {
  refreshMinutes: number;
  perCycle: number;
}

export interface RiskWorker {
  /** `book` is the mint list the scanner just refreshed. Wanted mints are always included. */
  runCycle(book?: string[]): Promise<RiskStats>;
  stats(): RiskStats;
}

export function createRiskWorker(deps: {
  db: Database;
  redis: Redis;
  providers: Providers;
  log: Logger;
  config: RiskWorkerConfig;
  now?: () => Date;
  onVerdict?: (mint: string, verdict: string, score: number | null, band: string | null) => Promise<unknown>;
}): RiskWorker {
  const { db, redis, providers, log, config } = deps;
  const now = deps.now ?? (() => new Date());
  let running = false;
  const stats: RiskStats = {
    lastRunAt: null,
    lastCycleMs: null,
    evaluatedLastCycle: 0,
    reportsTotal: 0,
    lastError: null,
  };

  async function wantedMints(): Promise<string[]> {
    try {
      return await redis.smembers(WANTED_KEY);
    } catch (error) {
      log.warn({ err: String(error) }, "could not read risk:wanted");
      return [];
    }
  }

  async function staleMints(current: Date): Promise<string[]> {
    const cutoff = new Date(current.getTime() - config.refreshMinutes * 60_000).toISOString();
    const stale = await db.execute<{ mint: string }>(sql`
      select t.mint
      from tokens t
      left join lateral (
        select ts from risk_reports r where r.mint = t.mint order by r.ts desc limit 1
      ) latest on true
      where latest.ts is null or latest.ts < ${cutoff}::timestamptz
      order by latest.ts asc nulls first, t.first_seen_at desc
      limit 200
    `);
    return stale.map((r) => r.mint);
  }

  async function loadMarkets(mints: string[]): Promise<MarketRow[]> {
    const out: MarketRow[] = [];
    for (let i = 0; i < mints.length; i += 100) {
      const chunk = mints.slice(i, i + 100);
      const rows = await db.execute(sql`
        select t.mint,
               t.latest_volume_24h,
               t.latest_market_cap,
               t.latest_liquidity_usd,
               t.created_at,
               t.first_seen_at,
               snap.volume_5m,
               snap.volume_1h,
               latest.verdict as latest_verdict,
               latest.ts as latest_ts
        from tokens t
        left join lateral (
          select volume_5m, volume_1h
          from token_snapshots s
          where s.mint = t.mint
          order by s.ts desc
          limit 1
        ) snap on true
        left join lateral (
          select verdict, ts
          from risk_reports r
          where r.mint = t.mint
          order by r.ts desc
          limit 1
        ) latest on true
        where t.mint in (${sql.join(chunk.map((mint) => sql`${mint}`), sql`, `)})
      `);
      out.push(...(rows as unknown as MarketRow[]));
    }
    return out;
  }

  async function writeCheap(mint: string, current: Date, reasons: RuleResult[], verdict: "BLOCKED" | "UNVERIFIED") {
    await withDbWrite(() => db.insert(schema.riskReports).values({
      mint,
      ts: current,
      verdict,
      score: null,
      hardFailReasons: reasons.filter((r) => r.result === "fail"),
      scoreBreakdown: {
        reasons,
        unavailableSources: ["dexscreener"],
        band: null,
        cheapGate: true,
      },
      rawSources: { cheapGate: true },
      configVersion: CONFIG_VERSION,
    }));
    try {
      await redis.srem(WANTED_KEY, mint);
    } catch {
      // Redis down is already visible on health; the report is stored.
    }
  }

  async function persist(mint: string, current: Date) {
    const { evaluation, creatorWallet, peakLiquidityUsd, rugDetected } = await evaluateMint(mint, { db, providers, now: current });
    await withDbWrite(async () => {
    await db.insert(schema.riskReports).values({
      mint,
      ts: current,
      verdict: evaluation.verdict,
      score: evaluation.score,
      hardFailReasons: evaluation.reasons.filter((r) => r.result === "fail"),
      scoreBreakdown: {
        factors: evaluation.factors,
        reasons: evaluation.reasons,
        unavailableSources: evaluation.unavailableSources,
        dataFreshness: evaluation.dataFreshness,
        band: evaluation.band,
      },
      rawSources: { unavailable: evaluation.unavailableSources },
      configVersion: evaluation.configVersion,
    });
    await db
      .update(schema.tokens)
      .set({
        creatorWallet: creatorWallet ?? undefined,
        peakLiquidityUsd: peakLiquidityUsd !== null ? String(peakLiquidityUsd) : undefined,
        rugDetectedAt: rugDetected ? current : undefined,
      })
      .where(eq(schema.tokens.mint, mint));
    });
    try {
      await redis.srem(WANTED_KEY, mint);
    } catch {
      // Redis down is already visible on health; the report is stored.
    }
    return evaluation;
  }

  return {
    async runCycle(book?: string[]) {
      if (running) return stats;
      running = true;
      const current = now();
      const started = performance.now();
      let evaluated = 0;
      try {
        const wanted = await wantedMints();
        const scanned = book && book.length > 0 ? book : await staleMints(current);
        const mints = [...new Set([...wanted, ...scanned])];
        const solUsd = mints.length > 0 ? await solUsdPrice(providers) : null;
        const markets = await loadMarkets(mints);
        const byMint = new Map(markets.map((row) => [row.mint, row]));
        const refreshBefore = current.getTime() - config.refreshMinutes * 60_000;
        const full: string[] = [];

        for (const mint of mints) {
          const row = byMint.get(mint);
          if (!row) continue;
          const gate = cheapGate(toMarket(row, solUsd, current));
          if (gate.verdict !== "PASS") {
            if (shouldWriteCheap(row?.latest_verdict ?? null, gate.verdict)) {
              await writeCheap(mint, current, gate.reasons, gate.verdict);
              if (deps.onVerdict) await deps.onVerdict(mint, gate.verdict, null, null);
              evaluated += 1;
            }
            continue;
          }
          const latestTs = asDate(row?.latest_ts ?? null);
          const due = !latestTs || latestTs.getTime() < refreshBefore || row?.latest_verdict !== "PASS" || wanted.includes(mint);
          if (due) full.push(mint);
        }

        const ordered = [...wanted.filter((mint) => full.includes(mint)), ...full.filter((mint) => !wanted.includes(mint))].slice(0, config.perCycle);
        log.info({ book: mints.length, full: ordered.length, cheap: evaluated }, "risk cycle picked mints");
        for (const mint of ordered) {
          try {
            log.info({ mint }, "evaluating mint");
            const evaluation = await persist(mint, current);
            if (deps.onVerdict) await deps.onVerdict(mint, evaluation.verdict, evaluation.score, evaluation.band);
            evaluated += 1;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log.warn({ mint, err: message }, "risk evaluate failed for mint");
            try {
              await withDbWrite(() => db.insert(schema.riskReports).values({
                mint,
                ts: current,
                verdict: "UNVERIFIED",
                score: null,
                hardFailReasons: [],
                scoreBreakdown: {
                  reasons: [
                    {
                      rule: "evaluate",
                      result: "unverified",
                      value: null,
                      threshold: null,
                      detail: "evaluation failed; fail closed",
                    },
                  ],
                },
                rawSources: { error: message },
                configVersion: CONFIG_VERSION,
              }));
              if (deps.onVerdict) await deps.onVerdict(mint, "UNVERIFIED", null, null);
              evaluated += 1;
            } catch (writeError) {
              log.warn({ mint, err: String(writeError) }, "could not persist UNVERIFIED report");
            }
          }
        }
        const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.riskReports);
        stats.evaluatedLastCycle = evaluated;
        stats.reportsTotal = count?.n ?? 0;
        stats.lastError = null;
        log.info({ evaluated, queued: ordered.length, reports: stats.reportsTotal, ms: Math.round(performance.now() - started) }, "risk cycle complete");
      } catch (error) {
        stats.lastError = error instanceof Error ? error.message : String(error);
        log.error({ err: stats.lastError }, "risk cycle failed");
      } finally {
        stats.lastRunAt = current.toISOString();
        stats.lastCycleMs = Math.round(performance.now() - started);
        running = false;
      }
      return stats;
    },
    stats: () => stats,
  };
}

interface MarketRow {
  mint: string;
  latest_volume_24h: string | number | null;
  latest_market_cap: string | number | null;
  latest_liquidity_usd: string | number | null;
  created_at: Date | string | null;
  first_seen_at: Date | string | null;
  volume_5m: string | number | null;
  volume_1h: string | number | null;
  latest_verdict: string | null;
  latest_ts: Date | string | null;
}

function shouldWriteCheap(latest: string | null, next: "BLOCKED" | "UNVERIFIED"): boolean {
  if (next === "BLOCKED") return latest !== "BLOCKED";
  return latest === null || latest === "PASS";
}

function toMarket(row: MarketRow | undefined, solUsd: number | null, current: Date): CheapMarket {
  const born = asDate(row?.created_at ?? null) ?? asDate(row?.first_seen_at ?? null);
  return {
    volume24hUsd: num(row?.latest_volume_24h),
    volume5mUsd: num(row?.volume_5m),
    volume1hUsd: num(row?.volume_1h),
    marketCapUsd: num(row?.latest_market_cap),
    liquidityUsd: num(row?.latest_liquidity_usd),
    ageHours: born ? (current.getTime() - born.getTime()) / 3_600_000 : null,
    solUsd,
  };
}

function num(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

function asDate(value: Date | string | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
