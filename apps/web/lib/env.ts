import { parseEnv, webEnvSchema, type WebEnv } from "@meme-guard/shared-types";

let cached: WebEnv | undefined;

/** Server-only. Validates once per process and fails loudly if WORKER_URL, DATABASE_URL or REDIS_URL is missing. */
export function getWebEnv(): WebEnv {
  if (!cached) cached = parseEnv(webEnvSchema);
  return cached;
}
