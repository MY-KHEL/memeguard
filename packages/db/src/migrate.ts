import { fileURLToPath } from "node:url";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { dbEnvSchema, parseEnv } from "@meme-guard/shared-types";

const env = parseEnv(dbEnvSchema);
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

const sql = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
const db = drizzle(sql);

const startedAt = Date.now();
try {
  await migrate(db, { migrationsFolder });
  console.log(JSON.stringify({ level: "info", msg: "migrations applied", durationMs: Date.now() - startedAt }));
} catch (error) {
  console.error(JSON.stringify({ level: "error", msg: "migration failed", error: String(error) }));
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
