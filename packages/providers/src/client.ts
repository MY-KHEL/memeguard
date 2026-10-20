import type { z } from "zod";
import { cacheKey, createCache, type ProviderCache } from "./cache";
import { fetchJson } from "./http";
import { createRateLimiter, type RateLimiter } from "./rate-limit";
import { fail, succeed, type ProviderDeps, type ProviderName, type ProviderResult } from "./types";

export interface ProviderClientConfig {
  name: ProviderName;
  baseUrl: string;
  /** Default budget for buckets that do not set their own. */
  rateLimitPerMinute: number;
  timeoutMs: number;
  defaultHeaders?: Record<string, string>;
}

export interface RequestOptions<T> {
  path: string;
  schema: z.ZodType<T>;
  method?: "GET" | "POST";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Cache key parts. Omit to skip caching. */
  cache?: { parts: Array<string | number | undefined>; ttlSeconds: number };
  /** Rate limit bucket (defaults to provider name) and optional per-bucket limit. */
  bucket?: string;
  bucketLimitPerMinute?: number;
  notFoundStatuses?: number[];
}

export interface ProviderClient {
  readonly name: ProviderName;
  readonly baseUrl: string;
  request<T>(opts: RequestOptions<T>): Promise<ProviderResult<T>>;
  cache: ProviderCache;
  limiter: RateLimiter;
}

/**
 * Common pipeline for every provider: cache lookup, rate limit check, fetch
 * with timeout and retries, zod parse, cache write. Never throws.
 */
export function createProviderClient(config: ProviderClientConfig, deps: ProviderDeps): ProviderClient {
  const cache = createCache(deps.store, deps.log);
  const limiter = createRateLimiter(deps.store, deps.log, deps.now);

  return {
    name: config.name,
    baseUrl: config.baseUrl,
    cache,
    limiter,
    async request(opts) {
      const key = opts.cache ? cacheKey(config.name, opts.cache.parts) : undefined;
      if (key) {
        const hit = await cache.get(key, opts.schema);
        if (hit !== undefined) return succeed(config.name, hit, true);
      }

      const bucket = opts.bucket ?? config.name;
      const allowed = await limiter.take(bucket, opts.bucketLimitPerMinute ?? config.rateLimitPerMinute);
      if (!allowed) {
        deps.log.warn({ provider: config.name, bucket }, "provider rate limit budget exhausted");
        return fail(config.name, "rate_limited", `local budget exhausted for ${bucket}`);
      }

      const url = new URL(opts.path.replace(/^\//, ""), config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`);
      for (const [k, v] of Object.entries(opts.query ?? {})) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }

      const started = Date.now();
      const result = await fetchJson({
        source: config.name,
        url: url.toString(),
        schema: opts.schema,
        method: opts.method,
        headers: { ...config.defaultHeaders, ...opts.headers },
        body: opts.body,
        timeoutMs: config.timeoutMs,
        fetchImpl: deps.fetchImpl,
        notFoundStatuses: opts.notFoundStatuses,
      });

      if (result.ok) {
        deps.log.debug({ provider: config.name, path: opts.path, ms: Date.now() - started }, "provider ok");
        if (key && opts.cache) await cache.set(key, result.data, opts.cache.ttlSeconds);
      } else {
        deps.log.warn(
          { provider: config.name, path: opts.path, reason: result.reason, err: result.error, ms: Date.now() - started },
          "provider call failed",
        );
      }
      return result;
    },
  };
}
