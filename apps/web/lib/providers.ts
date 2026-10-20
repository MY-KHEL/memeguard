import Redis from "ioredis";
import { createProviders, type Providers } from "@meme-guard/providers";
import { getWebEnv } from "./env";
import { logger } from "./logger";

/**
 * Server-only. Route handlers read market data on demand (candles, holders,
 * metadata) through the same provider modules the worker uses. Cache and
 * rate-limit state live in Redis so both processes share one budget.
 * No long-running jobs here; those belong to apps/worker.
 */
const globalForProviders = globalThis as unknown as { __memeGuardProviders?: Providers; __memeGuardRedis?: Redis };

export function getRedis(): Redis {
  if (!globalForProviders.__memeGuardRedis) {
    const redis = new Redis(getWebEnv().REDIS_URL, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      // Queue the first requests briefly while connecting; bound every command so a dead Redis cannot hang a route.
      enableOfflineQueue: true,
      commandTimeout: 1500,
      retryStrategy: (times) => Math.min(times * 500, 5000),
    });
    redis.on("error", (err) => logger.warn({ err: err.message }, "redis connection error"));
    globalForProviders.__memeGuardRedis = redis;
  }
  return globalForProviders.__memeGuardRedis;
}

export function getProviders(): Providers {
  if (!globalForProviders.__memeGuardProviders) {
    globalForProviders.__memeGuardProviders = createProviders({
      store: getRedis(),
      log: logger.child({ module: "providers" }),
      env: getWebEnv(),
    });
  }
  return globalForProviders.__memeGuardProviders;
}
