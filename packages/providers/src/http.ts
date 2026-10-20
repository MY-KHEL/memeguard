import type { z } from "zod";
import { fail, succeed, type ProviderName, type ProviderResult } from "./types";

export interface FetchJsonOptions<T> {
  source: ProviderName;
  url: string;
  schema: z.ZodType<T>;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  /** Retries on 429 and 5xx and on network errors. Default 2. */
  retries?: number;
  fetchImpl?: typeof fetch;
  /** Treat these statuses as not_found instead of unavailable. */
  notFoundStatuses?: number[];
}

const RETRYABLE = (status: number) => status === 429 || status >= 500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch JSON with a timeout, bounded retries with backoff, and zod parsing.
 * Never throws. Network, timeout, HTTP and shape errors all become ok:false.
 */
export async function fetchJson<T>(opts: FetchJsonOptions<T>): Promise<ProviderResult<T>> {
  const retries = opts.retries ?? 2;
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  let lastError = "";

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(Math.min(250 * 2 ** (attempt - 1), 2000));

    let res: Response;
    try {
      res = await doFetch(opts.url, {
        method: opts.method ?? "GET",
        headers: {
          accept: "application/json",
          ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
          ...opts.headers,
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
    } catch (error) {
      const isTimeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt === retries) return fail(opts.source, isTimeout ? "timeout" : "unavailable", lastError);
      continue;
    }

    if (opts.notFoundStatuses?.includes(res.status)) {
      return fail(opts.source, "not_found", `HTTP ${res.status}`);
    }

    if (!res.ok) {
      lastError = `HTTP ${res.status}`;
      if (RETRYABLE(res.status) && attempt < retries) continue;
      return fail(opts.source, res.status === 429 ? "rate_limited" : "unavailable", lastError);
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch (error) {
      return fail(opts.source, "invalid_response", error instanceof Error ? error.message : "invalid json");
    }

    const parsed = opts.schema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const where = first ? `${first.path.join(".") || "(root)"}: ${first.message}` : "schema mismatch";
      return fail(opts.source, "invalid_response", where);
    }
    return succeed(opts.source, parsed.data, false);
  }

  return fail(opts.source, "unavailable", lastError || "exhausted retries");
}
