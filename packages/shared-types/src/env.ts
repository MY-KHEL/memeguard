import { z } from "zod";

/**
 * Typed settings. Each process validates only the variables it needs and fails
 * at startup with a readable list of what is missing.
 *
 * Provider keys are optional here on purpose: in Phase 0 nothing calls them,
 * and later phases must treat a missing key as UNVERIFIED, never as "skip".
 */

const nonEmpty = z.string().trim().min(1);
const optionalKey = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? undefined : v))
  .optional();

const port = z.coerce.number().int().min(1).max(65535);

const optionalUrl = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? undefined : v))
  .pipe(z.string().url().optional())
  .optional();

export const providerKeysSchema = z.object({
  HELIUS_API_KEY: optionalKey,
  BIRDEYE_API_KEY: optionalKey,
  RUGCHECK_API_KEY: optionalKey,
  JUPITER_API_KEY: optionalKey,
  COINGECKO_API_KEY: optionalKey,
  // Base URL overrides. Only for tests and for simulating an outage locally.
  DEXSCREENER_BASE_URL: optionalUrl,
  COINGECKO_BASE_URL: optionalUrl,
  GECKOTERMINAL_BASE_URL: optionalUrl,
  BIRDEYE_BASE_URL: optionalUrl,
  HELIUS_RPC_URL: optionalUrl,
  HELIUS_API_URL: optionalUrl,
  RUGCHECK_BASE_URL: optionalUrl,
  JUPITER_BASE_URL: optionalUrl,
});
export type ProviderKeysEnv = z.infer<typeof providerKeysSchema>;

const logLevel = z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info");

export const workerEnvSchema = providerKeysSchema.extend({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: nonEmpty,
  REDIS_URL: nonEmpty,
  WORKER_PORT: port.default(4000),
  LOG_LEVEL: logLevel,
  // Phase 1 scanner (docs/SPEC.md 6.1).
  SCAN_INTERVAL_MS: z.coerce.number().int().min(5000).default(20000),
  TRACK_WINDOW_HOURS: z.coerce.number().int().min(1).default(24),
  SNAPSHOT_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
  SCANNER_USE_GECKO_NEW_POOLS: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  RISK_REFRESH_MINUTES: z.coerce.number().int().min(1).default(30),
  RISK_PER_CYCLE: z.coerce.number().int().min(1).max(50).default(8),
  LIVE_QUOTE_INTERVAL_MS: z.coerce.number().int().min(1000).default(1000),
  LIVE_MAX_WATCHED: z.coerce.number().int().min(1).max(300).default(90),
  REGIME_INTERVAL_MS: z.coerce.number().int().min(60_000).default(1_800_000),
  OUTCOME_INTERVAL_MS: z.coerce.number().int().min(30_000).default(300_000),
  ALERT_INTERVAL_MS: z.coerce.number().int().min(5_000).default(15_000),
});
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

const optionalWallet = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? undefined : v))
  .pipe(z.string().min(32).max(64).optional())
  .optional();

export const webEnvSchema = providerKeysSchema.extend({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  WORKER_URL: z.string().trim().url(),
  DATABASE_URL: nonEmpty,
  REDIS_URL: nonEmpty,
  LOG_LEVEL: logLevel,
  SESSION_SECRET: nonEmpty,
  DEV_WALLET: optionalWallet,
  CALIBRATION_ADMIN_WALLET: optionalWallet,
});
export type WebEnv = z.infer<typeof webEnvSchema>;

export const dbEnvSchema = z.object({
  DATABASE_URL: nonEmpty,
});
export type DbEnv = z.infer<typeof dbEnvSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment:\n  - ${issues.join("\n  - ")}`);
    this.name = "EnvValidationError";
  }
}

export function parseEnv<T extends z.ZodTypeAny>(
  schema: T,
  source: Record<string, string | undefined> = process.env,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => {
    const key = issue.path.join(".") || "(root)";
    return `${key}: ${issue.message}`;
  });
  throw new EnvValidationError(issues);
}
