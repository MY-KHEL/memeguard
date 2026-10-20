import { createDb, type DbHandle } from "@meme-guard/db";
import { getWebEnv } from "./env";

/**
 * Server-only. One Postgres pool per process. Next.js dev reloads modules,
 * so the handle is parked on globalThis to avoid leaking connections.
 */
const globalForDb = globalThis as unknown as { __memeGuardDb?: DbHandle };

export function getDb(): DbHandle {
  if (!globalForDb.__memeGuardDb) {
    globalForDb.__memeGuardDb = createDb(getWebEnv().DATABASE_URL, { max: 5, statementTimeoutMs: 15_000 });
  }
  return globalForDb.__memeGuardDb;
}
