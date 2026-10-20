import type { ProviderResult } from "@meme-guard/providers";
import { logger } from "./logger";

const NO_STORE = { "cache-control": "no-store" } as const;

export function jsonOk(payload: unknown, init?: ResponseInit): Response {
  return Response.json(payload, { ...init, headers: { ...NO_STORE, ...init?.headers } });
}

export function jsonError(status: number, error: string, detail?: unknown): Response {
  return Response.json({ error, detail }, { status, headers: NO_STORE });
}

/**
 * Market-data routes always answer 200 so the page renders. A provider
 * failure becomes { ok: false, reason } and the UI names the gap.
 */
export function providerJson<T>(result: ProviderResult<T>): Response {
  if (result.ok) {
    return jsonOk({ ok: true, data: result.data, source: result.source, fetchedAt: result.fetchedAt, fromCache: result.fromCache });
  }
  return jsonOk({ ok: false, reason: result.reason, source: result.source, error: result.error });
}

/** Wraps a handler so unexpected exceptions become a logged 500 instead of a crash. */
export function withErrorBoundary<Args extends unknown[]>(name: string, handler: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ route: name, err: message }, "route handler failed");
      return jsonError(500, "internal error");
    }
  };
}
