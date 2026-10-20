import type { KeyValueStore, ProviderLogger } from "./types";

export interface RateLimiter {
  /** Returns true if a request may proceed within the current one-minute window. */
  take(bucket: string, limitPerMinute: number): Promise<boolean>;
}

const WINDOW_MS = 60_000;

/**
 * Fixed one-minute window shared through the key-value store, so the worker
 * and the web route handlers draw from one budget per provider.
 * If the store fails, the call is allowed (the provider's own 429 handling
 * remains the backstop) and the failure is logged.
 */
export function createRateLimiter(
  store: KeyValueStore,
  log: ProviderLogger,
  now: () => number = Date.now,
): RateLimiter {
  return {
    async take(bucket, limitPerMinute) {
      const window = Math.floor(now() / WINDOW_MS);
      const key = `ratelimit:${bucket}:${window}`;
      try {
        const count = await store.incr(key);
        if (count === 1) await store.pexpire(key, WINDOW_MS * 2);
        return count <= limitPerMinute;
      } catch (error) {
        log.warn({ bucket, err: String(error) }, "rate limiter store failed; allowing request");
        return true;
      }
    },
  };
}

/** In-memory store for tests and single-process fallbacks. */
export function createMemoryStore(now: () => number = Date.now): KeyValueStore {
  const values = new Map<string, { value: string; expiresAt: number }>();
  const live = (key: string) => {
    const entry = values.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) {
      values.delete(key);
      return undefined;
    }
    return entry;
  };
  return {
    async get(key) {
      return live(key)?.value ?? null;
    },
    async set(key, value, _px, ttlMs) {
      values.set(key, { value, expiresAt: now() + ttlMs });
      return "OK";
    },
    async incr(key) {
      const entry = live(key);
      const next = (entry ? Number(entry.value) : 0) + 1;
      values.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? Number.POSITIVE_INFINITY });
      return next;
    },
    async pexpire(key, ttlMs) {
      const entry = live(key);
      if (entry) entry.expiresAt = now() + ttlMs;
      return entry ? 1 : 0;
    },
  };
}
