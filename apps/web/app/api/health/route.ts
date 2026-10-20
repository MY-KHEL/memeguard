import { appHealthSchema, workerHealthSchema, type AppHealth } from "@meme-guard/shared-types";
import { getWebEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

const WORKER_TIMEOUT_MS = 3000;

export async function GET() {
  const checkedAt = new Date().toISOString();
  let result: AppHealth;

  try {
    const { WORKER_URL } = getWebEnv();
    const res = await fetch(new URL("/health", WORKER_URL), {
      cache: "no-store",
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    const body: unknown = await res.json();
    const report = workerHealthSchema.parse(body);
    result = {
      service: "web",
      status: report.status === "ok" ? "ok" : "degraded",
      checkedAt,
      worker: { reachable: true, report },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ err: message }, "worker health unreachable");
    result = {
      service: "web",
      status: "worker_unavailable",
      checkedAt,
      worker: { reachable: false, error: message },
    };
  }

  const payload = appHealthSchema.parse(result);
  return Response.json(payload, {
    status: payload.status === "worker_unavailable" ? 503 : 200,
    headers: { "cache-control": "no-store" },
  });
}
