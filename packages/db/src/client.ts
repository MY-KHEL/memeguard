import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;
export type DbSql = postgres.Sql;

export interface DbHandle {
  db: Database;
  sql: DbSql;
  close: () => Promise<void>;
}

export function createDb(databaseUrl: string, options: { max?: number; statementTimeoutMs?: number } = {}): DbHandle {
  const sql = postgres(databaseUrl, {
    max: options.max ?? 10,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
    connection: options.statementTimeoutMs
      ? {
          statement_timeout: options.statementTimeoutMs,
          idle_in_transaction_session_timeout: 10_000,
        }
      : undefined,
  });
  const db = drizzle(sql, { schema });
  return {
    db,
    sql,
    close: () => sql.end({ timeout: 5 }),
  };
}

/** Lightweight reachability check for health endpoints. */
export async function pingDb(sql: DbSql, timeoutMs = 2000): Promise<void> {
  await Promise.race([
    sql`select 1`,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`postgres ping timed out after ${timeoutMs}ms`)), timeoutMs)),
  ]);
}
