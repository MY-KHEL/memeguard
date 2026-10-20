import { z } from "zod";

export const dependencyStatusSchema = z.enum(["ok", "down"]);
export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;

export const dependencyCheckSchema = z.object({
  status: dependencyStatusSchema,
  latencyMs: z.number().nonnegative().optional(),
  error: z.string().optional(),
});
export type DependencyCheck = z.infer<typeof dependencyCheckSchema>;

export const scannerStatsSchema = z.object({
  lastRunAt: z.string().datetime().nullable(),
  lastCycleMs: z.number().nonnegative().nullable(),
  tokensTracked: z.number().int().nonnegative(),
  discoveredLastCycle: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  providers: z.object({ birdeye: z.boolean(), helius: z.boolean(), jupiter: z.boolean() }),
});
export type ScannerStats = z.infer<typeof scannerStatsSchema>;

export const riskStatsSchema = z.object({
  lastRunAt: z.string().datetime().nullable(),
  lastCycleMs: z.number().nonnegative().nullable(),
  evaluatedLastCycle: z.number().int().nonnegative(),
  reportsTotal: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
});
export type RiskStats = z.infer<typeof riskStatsSchema>;

export const jobStatsSchema = z.object({
  lastRunAt: z.string().datetime().nullable(),
  lastCycleMs: z.number().nonnegative().nullable(),
  lastError: z.string().nullable(),
});
export type JobStats = z.infer<typeof jobStatsSchema>;

/** Jobs may still be on their first tick during this window; after it, null lastRunAt is a stall. */
export const JOB_GRACE_SECONDS = 90;

export function isJobStale(
  job: { lastRunAt: string | null; lastError: string | null } | undefined,
  uptimeSeconds: number,
): boolean {
  if (!job) return false;
  if (job.lastError) return true;
  if (job.lastRunAt) return false;
  return uptimeSeconds >= JOB_GRACE_SECONDS;
}

/** Returned by the worker at GET /health. */
export const workerHealthSchema = z.object({
  service: z.literal("worker"),
  status: z.enum(["ok", "degraded"]),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  checkedAt: z.string().datetime(),
  checks: z.object({
    postgres: dependencyCheckSchema,
    redis: dependencyCheckSchema,
  }),
  /** Phase 1 scanner stats. Absent until the first cycle completes. */
  scanner: scannerStatsSchema.optional(),
  risk: riskStatsSchema.optional(),
  regime: jobStatsSchema.optional(),
  outcomes: jobStatsSchema.optional(),
  alerts: jobStatsSchema.optional(),
});
export type WorkerHealth = z.infer<typeof workerHealthSchema>;

/** Returned by the web app at GET /api/health. Wraps the worker report. */
export const appHealthSchema = z.object({
  service: z.literal("web"),
  status: z.enum(["ok", "degraded", "worker_unavailable"]),
  checkedAt: z.string().datetime(),
  worker: z.union([
    z.object({ reachable: z.literal(true), report: workerHealthSchema }),
    z.object({ reachable: z.literal(false), error: z.string() }),
  ]),
});
export type AppHealth = z.infer<typeof appHealthSchema>;
