import http from "node:http";
import type Redis from "ioredis";
import { pingDb, type DbSql } from "@meme-guard/db";
import {
  isJobStale,
  workerHealthSchema,
  type DependencyCheck,
  type JobStats,
  type RiskStats,
  type ScannerStats,
  type WorkerHealth,
} from "@meme-guard/shared-types";
import type { Logger } from "./logger";

interface HealthDeps {
  sql: DbSql;
  redis: Redis;
  version: string;
  startedAt: number;
  log: Logger;
  /** Optional so Phase 0 style health checks still work without a scanner. */
  scannerStats?: () => ScannerStats;
  riskStats?: () => RiskStats;
  regimeStats?: () => JobStats;
  outcomeStats?: () => JobStats;
  alertStats?: () => JobStats;
}

async function timed(check: () => Promise<unknown>): Promise<DependencyCheck> {
  const start = performance.now();
  try {
    await check();
    return { status: "ok", latencyMs: Math.round(performance.now() - start) };
  } catch (error) {
    return {
      status: "down",
      latencyMs: Math.round(performance.now() - start),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function pingRedis(redis: Redis, timeoutMs = 2000): Promise<void> {
  await Promise.race([
    redis.ping(),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`redis ping timed out after ${timeoutMs}ms`)), timeoutMs)),
  ]);
}

export async function buildHealthReport(deps: HealthDeps): Promise<WorkerHealth> {
  const [postgresCheck, redisCheck] = await Promise.all([
    timed(() => pingDb(deps.sql)),
    timed(() => pingRedis(deps.redis)),
  ]);
  const uptimeSeconds = Math.round((Date.now() - deps.startedAt) / 1000);
  const scanner = deps.scannerStats?.();
  const risk = deps.riskStats?.();
  const regime = deps.regimeStats?.();
  const outcomes = deps.outcomeStats?.();
  const alerts = deps.alertStats?.();
  const jobsOk =
    !isJobStale(scanner, uptimeSeconds) &&
    !isJobStale(risk, uptimeSeconds) &&
    !isJobStale(regime, uptimeSeconds) &&
    !isJobStale(outcomes, uptimeSeconds) &&
    !isJobStale(alerts, uptimeSeconds);
  const allOk = postgresCheck.status === "ok" && redisCheck.status === "ok" && jobsOk;
  const report: WorkerHealth = {
    service: "worker",
    status: allOk ? "ok" : "degraded",
    version: deps.version,
    uptimeSeconds,
    checkedAt: new Date().toISOString(),
    checks: { postgres: postgresCheck, redis: redisCheck },
    scanner,
    risk,
    regime,
    outcomes,
    alerts,
  };
  return workerHealthSchema.parse(report);
}

export function startHealthServer(port: number, deps: HealthDeps): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.method !== "GET" || req.url !== "/health") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    try {
      const report = await buildHealthReport(deps);
      res.writeHead(report.status === "ok" ? 200 : 503, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(report));
    } catch (error) {
      deps.log.error({ err: error }, "health check failed");
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "health check failed" }));
    }
  });
  server.listen(port, "0.0.0.0", () => deps.log.info({ port }, "health server listening"));
  return server;
}
