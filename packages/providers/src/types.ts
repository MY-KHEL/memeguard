/**
 * Shared contracts for every provider module (docs/SPEC.md section 5).
 * A provider never throws on upstream failure; it returns ProviderResult.
 */

export type ProviderFailureReason =
  | "unavailable"
  | "rate_limited"
  | "timeout"
  | "invalid_response"
  | "not_configured"
  | "not_found";

export type ProviderResult<T> =
  | { ok: true; data: T; fetchedAt: string; fromCache: boolean; source: ProviderName }
  | { ok: false; reason: ProviderFailureReason; error?: string; source: ProviderName };

export type ProviderName = "dexscreener" | "geckoterminal" | "birdeye" | "helius" | "rugcheck" | "jupiter" | "coingecko";

export function fail<T = never>(
  source: ProviderName,
  reason: ProviderFailureReason,
  error?: string,
): ProviderResult<T> {
  return { ok: false, reason, error, source };
}

export function succeed<T>(source: ProviderName, data: T, fromCache: boolean): ProviderResult<T> {
  return { ok: true, data, fetchedAt: new Date().toISOString(), fromCache, source };
}

/** Minimal pino-compatible logger surface so this package does not depend on pino. */
export interface ProviderLogger {
  debug: (obj: Record<string, unknown>, msg?: string) => void;
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
}

/**
 * The subset of Redis the providers need. ioredis satisfies this directly;
 * tests use an in-memory implementation.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, px: "PX", ttlMs: number): Promise<unknown>;
  incr(key: string): Promise<number>;
  pexpire(key: string, ttlMs: number, nx?: "NX"): Promise<unknown>;
}

export interface ProviderEnv {
  HELIUS_API_KEY?: string;
  BIRDEYE_API_KEY?: string;
  RUGCHECK_API_KEY?: string;
  JUPITER_API_KEY?: string;
  COINGECKO_API_KEY?: string;
  /** Base URL overrides. Used in tests and to simulate outages. */
  DEXSCREENER_BASE_URL?: string;
  COINGECKO_BASE_URL?: string;
  GECKOTERMINAL_BASE_URL?: string;
  BIRDEYE_BASE_URL?: string;
  HELIUS_RPC_URL?: string;
  HELIUS_API_URL?: string;
  RUGCHECK_BASE_URL?: string;
  JUPITER_BASE_URL?: string;
}

export interface ProviderDeps {
  store: KeyValueStore;
  log: ProviderLogger;
  env: ProviderEnv;
  /** Injected for tests. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  now?: () => number;
}
