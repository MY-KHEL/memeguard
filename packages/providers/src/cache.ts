import type { z } from "zod";
import type { KeyValueStore, ProviderLogger } from "./types";

export interface ProviderCache {
  get<T>(key: string, schema: z.ZodType<T>): Promise<T | undefined>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
}

/**
 * JSON cache on top of the key-value store. Read or write failures are
 * logged and swallowed; a broken cache must never break a provider call.
 */
export function createCache(store: KeyValueStore, log: ProviderLogger): ProviderCache {
  return {
    async get(key, schema) {
      try {
        const raw = await store.get(key);
        if (raw === null) return undefined;
        const parsed = schema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : undefined;
      } catch (error) {
        log.warn({ key, err: String(error) }, "provider cache read failed");
        return undefined;
      }
    },
    async set(key, value, ttlSeconds) {
      try {
        await store.set(key, JSON.stringify(value), "PX", Math.max(1, Math.round(ttlSeconds * 1000)));
      } catch (error) {
        log.warn({ key, err: String(error) }, "provider cache write failed");
      }
    },
  };
}

export function cacheKey(provider: string, parts: Array<string | number | undefined>): string {
  return `provider:${provider}:${parts.filter((p) => p !== undefined).join(":")}`;
}
