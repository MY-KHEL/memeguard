import { and, asc, gt, sql } from "drizzle-orm";
import { schema, type Database } from "@meme-guard/db";
import type { Providers } from "@meme-guard/providers";
import type { ScannerStats } from "@meme-guard/shared-types";
import { withDbWrite } from "../db-lock";
import type { Logger } from "../logger";
import { discoverTokens } from "./discover";
import { buildRows, emptyTokenRow, groupPairsByMint, type SnapshotRow, type TokenUpsertRow } from "./enrich";

/**
 * Scanner loop (docs/SPEC.md 6.1). One cycle:
 *   1. discover candidate mints from listing endpoints
 *   2. load tracked mints still inside the refresh window, stalest first
 *   3. one DexScreener batch call per 30 mints, map to rows
 *   4. upsert tokens, insert snapshots
 *   5. once a day, delete snapshots past retention
 * Cycles never overlap. Any failure is logged into stats and the next cycle still runs.
 */

export interface ScannerConfig {
  intervalMs: number;
  trackWindowHours: number;
  snapshotRetentionDays: number;
  useGeckoNewPools: boolean;
  /** Upper bound on tracked mints refreshed per cycle. 90 mints is three DexScreener batches. */
  maxRefreshPerCycle?: number;
}

export interface ScannerDeps {
  db: Database;
  providers: Providers;
  log: Logger;
  config: ScannerConfig;
  now?: () => Date;
  onAfterCycle?: (mints: string[]) => Promise<unknown>;
  onMarketRows?: (rows: TokenUpsertRow[]) => Promise<unknown>;
}

export interface Scanner {
  runCycle(): Promise<ScannerStats>;
  start(): void;
  stop(): void;
  stats(): ScannerStats;
}

const UPSERT_CHUNK = 20;
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CYCLE_TIMEOUT_MS = 180_000;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function clipError(error: unknown, max = 180): string {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : null;
  const top = error instanceof Error ? (error.message.split("\n")[0] ?? error.message) : String(error);
  const raw = cause ? `${cause} | ${top}` : top;
  return raw.length <= max ? raw : `${raw.slice(0, max)}…`;
}

export function createScanner(deps: ScannerDeps): Scanner {
  const { db, providers, log, config } = deps;
  const now = deps.now ?? (() => new Date());
  const maxRefresh = config.maxRefreshPerCycle ?? 90;

  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let stopped = false;
  let lastRetentionAt = 0;

  const stats: ScannerStats = {
    lastRunAt: null,
    lastCycleMs: null,
    tokensTracked: 0,
    discoveredLastCycle: 0,
    lastError: null,
    providers: providers.configured,
  };

  async function loadTrackedMints(current: Date): Promise<string[]> {
    const since = new Date(current.getTime() - config.trackWindowHours * 60 * 60 * 1000);
    const rows = await db
      .select({ mint: schema.tokens.mint })
      .from(schema.tokens)
      .where(gt(schema.tokens.firstSeenAt, since))
      .orderBy(sql`${schema.tokens.lastSnapshotAt} asc nulls first`, asc(schema.tokens.firstSeenAt))
      .limit(maxRefresh);
    return rows.map((r) => r.mint);
  }

  async function upsertTokens(rows: TokenUpsertRow[]) {
    const t = schema.tokens;
    const keep = (col: { name: string }) => sql.raw(`coalesce(excluded.${col.name}, tokens.${col.name})`);
    for (const batch of chunk(rows, UPSERT_CHUNK)) {
      await db
        .insert(t)
        .values(batch)
        .onConflictDoUpdate({
          target: t.mint,
          set: {
            symbol: keep(t.symbol),
            name: keep(t.name),
            createdAt: keep(t.createdAt),
            launchpad: keep(t.launchpad),
            pairAddress: keep(t.pairAddress),
            dexId: keep(t.dexId),
            imageUrl: keep(t.imageUrl),
            latestPrice: keep(t.latestPrice),
            latestMarketCap: keep(t.latestMarketCap),
            latestLiquidityUsd: keep(t.latestLiquidityUsd),
            latestVolume24h: keep(t.latestVolume24h),
            latestPriceChange1h: keep(t.latestPriceChange1h),
            lastSnapshotAt: keep(t.lastSnapshotAt),
          },
        });
    }
  }

  async function insertSnapshots(rows: SnapshotRow[]) {
    for (const batch of chunk(rows, UPSERT_CHUNK)) {
      await db.insert(schema.tokenSnapshots).values(batch);
    }
  }

  async function runRetention(current: Date) {
    if (current.getTime() - lastRetentionAt < RETENTION_INTERVAL_MS) return;
    const cutoff = new Date(current.getTime() - config.snapshotRetentionDays * 24 * 60 * 60 * 1000);
    await db.execute(sql`
      delete from token_snapshots
      where id in (
        select id from token_snapshots
        where ts < ${cutoff.toISOString()}::timestamptz
        limit 2000
      )
    `);
    lastRetentionAt = current.getTime();
    log.info({ cutoff: cutoff.toISOString() }, "snapshot retention batch applied");
  }

  async function countTracked(current: Date): Promise<number> {
    const since = new Date(current.getTime() - config.trackWindowHours * 60 * 60 * 1000);
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.tokens)
      .where(and(gt(schema.tokens.firstSeenAt, since)));
    return row?.n ?? 0;
  }

  async function runOnce(): Promise<string[]> {
    const started = performance.now();
    const current = now();
    let scannedMints: string[] = [];
    try {
      const discovery = await discoverTokens({
        dexscreener: providers.dexscreener,
        geckoterminal: providers.geckoterminal,
        useGeckoNewPools: config.useGeckoNewPools,
      });
      for (const e of discovery.errors) log.warn(e, "discovery source failed");

      const tracked = await loadTrackedMints(current);
      const discoveredPairs = new Map(discovery.tokens.map((t) => [t.mint, t.pairAddress]));
      const mints = [...new Set([...discovery.tokens.map((t) => t.mint), ...tracked])].slice(0, maxRefresh);
      scannedMints = mints;

      const market = mints.length > 0 ? await providers.dexscreener.getTokens("solana", mints) : null;
      const byMint = market?.ok ? groupPairsByMint(market.data) : new Map();
      if (market && !market.ok) log.warn({ reason: market.reason, error: market.error }, "market batch failed; inserting discovered mints without data");

      const tokenRows: TokenUpsertRow[] = [];
      const snapshotRows: SnapshotRow[] = [];
      for (const mint of mints) {
        const pairs = byMint.get(mint);
        if (pairs && pairs.length > 0) {
          const { token, snapshot } = buildRows(mint, pairs, current);
          tokenRows.push(token);
          if (snapshot) snapshotRows.push(snapshot);
        } else if (discoveredPairs.has(mint)) {
          // newly discovered but no market data yet: make it visible, refresh later
          tokenRows.push(emptyTokenRow(mint, discoveredPairs.get(mint) ?? null));
        }
      }

      await withDbWrite(async () => {
        if (tokenRows.length > 0) await upsertTokens(tokenRows);
        if (snapshotRows.length > 0) await insertSnapshots(snapshotRows);
        await runRetention(current);
      });
      if (tokenRows.length > 0 && deps.onMarketRows) await deps.onMarketRows(tokenRows);

      stats.discoveredLastCycle = discovery.tokens.length;
      stats.tokensTracked = await countTracked(current);
      stats.lastError =
        discovery.errors.length === discovery.tokens.length + discovery.errors.length && discovery.errors.length > 0
          ? `all discovery sources failed: ${discovery.errors.map((e) => `${e.source}=${e.reason}`).join(", ")}`
          : market && !market.ok
            ? `market data ${market.reason}`
            : null;

      log.info(
        {
          discovered: discovery.tokens.length,
          refreshed: tracked.length,
          upserted: tokenRows.length,
          snapshots: snapshotRows.length,
          tracked: stats.tokensTracked,
          ms: Math.round(performance.now() - started),
        },
        "scan cycle complete",
      );
      return scannedMints;
    } catch (error) {
      stats.lastError = clipError(error);
      log.error({ err: stats.lastError }, "scan cycle failed");
      return scannedMints;
    } finally {
      stats.lastRunAt = current.toISOString();
      stats.lastCycleMs = Math.round(performance.now() - started);
    }
  }

  async function runCycle(): Promise<ScannerStats> {
    if (running) return stats;
    running = true;
    let scannedMints: string[] = [];
    const work = runOnce()
      .then((mints) => {
        scannedMints = mints;
      })
      .finally(() => {
        running = false;
      });

    let timedOut = false;
    const timeout = new Promise<void>((resolve) => {
      const id = setTimeout(() => {
        timedOut = true;
        stats.lastError = `scan cycle timed out after ${CYCLE_TIMEOUT_MS}ms`;
        stats.lastRunAt = now().toISOString();
        log.error({ timeoutMs: CYCLE_TIMEOUT_MS }, "scan cycle timed out; next interval will skip until this one finishes");
        resolve();
      }, CYCLE_TIMEOUT_MS);
      void work.finally(() => clearTimeout(id));
    });

    await Promise.race([work, timeout]);
    if (!timedOut && !stats.lastError && deps.onAfterCycle) {
      try {
        await deps.onAfterCycle(scannedMints);
      } catch (error) {
        log.error({ err: String(error) }, "after-scan hook failed");
      }
    }
    return stats;
  }

  function schedule(delay: number) {
    if (stopped) return;
    timer = setTimeout(async () => {
      await runCycle();
      schedule(config.intervalMs);
    }, delay);
  }

  return {
    runCycle,
    start() {
      stopped = false;
      log.info({ intervalMs: config.intervalMs, trackWindowHours: config.trackWindowHours, useGeckoNewPools: config.useGeckoNewPools }, "scanner starting");
      schedule(0);
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    stats: () => stats,
  };
}
