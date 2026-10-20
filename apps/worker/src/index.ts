import Redis from "ioredis";
import { createDb } from "@meme-guard/db";
import { CONFIG_VERSION } from "@meme-guard/core";
import { EnvValidationError, parseEnv, workerEnvSchema } from "@meme-guard/shared-types";
import { createProviders } from "@meme-guard/providers";
import { startHealthServer } from "./health";
import { createLogger } from "./logger";
import { createLiveBus } from "./live/bus";
import { createAlertWorker } from "./alerts/run";
import { createBirdeyeCandles } from "./live/birdeye-candles";
import { createLiveQuotes } from "./live/quotes";
import { createOutcomeTracker } from "./outcomes/run";
import { createRegimeWorker } from "./regime/run";
import { createRiskWorker } from "./risk/run";
import { createScanner } from "./scanner/run";

const WORKER_VERSION = "0.1.0";

let env;
try {
  env = parseEnv(workerEnvSchema);
} catch (error) {
  if (error instanceof EnvValidationError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

const log = createLogger(env.LOG_LEVEL, env.NODE_ENV === "development");
const startedAt = Date.now();

log.info(
  {
    version: WORKER_VERSION,
    configVersion: CONFIG_VERSION,
    nodeEnv: env.NODE_ENV,
    providers: {
      helius: env.HELIUS_API_KEY ? "configured" : "missing",
      birdeye: env.BIRDEYE_API_KEY ? "configured" : "missing",
      rugcheck: env.RUGCHECK_API_KEY ? "configured" : "missing",
      jupiter: env.JUPITER_API_KEY ? "configured" : "missing",
    },
  },
  "worker starting",
);

const { db, sql, close: closeDb } = createDb(env.DATABASE_URL, { max: 5, statementTimeoutMs: 20_000 });

const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  commandTimeout: 5_000,
  retryStrategy: (times) => Math.min(times * 500, 5000),
});
redis.on("error", (err) => log.warn({ err: err.message }, "redis connection error"));
redis.on("ready", () => log.info("redis ready"));
const redisReady = redis.connect().catch((err: unknown) => log.warn({ err: String(err) }, "redis initial connect failed"));

// Providers share Redis for cache and rate-limit windows with the web app.
const providers = createProviders({
  store: redis,
  log: log.child({ module: "providers" }),
  env,
});

// Phase 1: scanner loop. Phase 2 adds risk reports; Phase 4 adds the outcome
// tracker and regime jobs. Long-running jobs live only in this process.
const liveBus = createLiveBus(redis, log.child({ module: "live" }));

const risk = createRiskWorker({
  db,
  redis,
  providers,
  log: log.child({ module: "risk" }),
  config: {
    refreshMinutes: env.RISK_REFRESH_MINUTES,
    perCycle: env.RISK_PER_CYCLE,
  },
  onVerdict: (mint, verdict, score, band) =>
    liveBus.publish({
      type: "token.verdict",
      mint,
      verdict: verdict as "PASS" | "BLOCKED" | "UNVERIFIED",
      score,
      band: band as "LOWER_RISK" | "MEDIUM" | "HIGH" | null,
      ts: new Date().toISOString(),
    }),
});

const scanner = createScanner({
  db,
  providers,
  log: log.child({ module: "scanner" }),
  config: {
    intervalMs: env.SCAN_INTERVAL_MS,
    trackWindowHours: env.TRACK_WINDOW_HOURS,
    snapshotRetentionDays: env.SNAPSHOT_RETENTION_DAYS,
    useGeckoNewPools: env.SCANNER_USE_GECKO_NEW_POOLS,
  },
  onAfterCycle: (mints) => risk.runCycle(mints),
  onMarketRows: async (rows) => {
    const ts = new Date().toISOString();
    const chunk = 25;
    for (let i = 0; i < rows.length; i += chunk) {
      await Promise.all(
        rows.slice(i, i + chunk).map((row) =>
          liveBus.publish({
            type: "token.tick",
            mint: row.mint,
            priceUsd: row.latestPrice === null ? null : Number(row.latestPrice),
            marketCapUsd: row.latestMarketCap === null ? null : Number(row.latestMarketCap),
            liquidityUsd: row.latestLiquidityUsd === null ? null : Number(row.latestLiquidityUsd),
            volume24hUsd: row.latestVolume24h === null ? null : Number(row.latestVolume24h),
            priceChange1hPct: row.latestPriceChange1h === null ? null : Number(row.latestPriceChange1h),
            ts,
          }),
        ),
      );
    }
  },
});

const birdeyeCandles = createBirdeyeCandles({
  bus: liveBus,
  log: log.child({ module: "birdeye-candles" }),
  apiKey: env.BIRDEYE_API_KEY,
});

const liveQuotes = createLiveQuotes({
  db,
  providers,
  bus: liveBus,
  log: log.child({ module: "live-quotes" }),
  intervalMs: env.LIVE_QUOTE_INTERVAL_MS,
  maxWatched: env.LIVE_MAX_WATCHED,
});

const regime = createRegimeWorker({
  db,
  providers,
  bus: liveBus,
  log: log.child({ module: "regime" }),
  intervalMs: env.REGIME_INTERVAL_MS,
});

const outcomes = createOutcomeTracker({
  db,
  log: log.child({ module: "outcomes" }),
  intervalMs: env.OUTCOME_INTERVAL_MS,
});

const alerts = createAlertWorker({
  db,
  bus: liveBus,
  log: log.child({ module: "alerts" }),
  intervalMs: env.ALERT_INTERVAL_MS,
});

const server = startHealthServer(env.WORKER_PORT, {
  sql,
  redis,
  version: WORKER_VERSION,
  startedAt,
  log,
  scannerStats: () => scanner.stats(),
  riskStats: () => risk.stats(),
  regimeStats: () => regime.stats(),
  outcomeStats: () => outcomes.stats(),
  alertStats: () => alerts.stats(),
});

// Start scanning once Redis has settled (connected or failed) so the first
// cycle's cache and rate-limit calls are not racing the connection handshake.
const RISK_INTERVAL_MS = 60_000;
let riskTimer: NodeJS.Timeout | null = null;

void redisReady.then(() => {
  scanner.start();
  liveQuotes.start();
  birdeyeCandles.start();
  alerts.start();
  regime.start();
  outcomes.start();
  const runRisk = () => {
    void risk.runCycle().catch((error: unknown) => log.warn({ err: String(error) }, "risk timer failed"));
  };
  runRisk();
  riskTimer = setInterval(runRisk, RISK_INTERVAL_MS);
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "worker shutting down");
  if (riskTimer) clearInterval(riskTimer);
  scanner.stop();
  liveQuotes.stop();
  birdeyeCandles.stop();
  regime.stop();
  outcomes.stop();
  alerts.stop();
  server.close();
  await Promise.allSettled([closeDb(), redis.quit()]);
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => log.error({ reason: String(reason) }, "unhandled rejection"));
