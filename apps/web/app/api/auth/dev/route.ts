import { eq } from "drizzle-orm";
import { schema } from "@meme-guard/db";
import { jsonError, jsonOk, withErrorBoundary } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { getWebEnv } from "@/lib/env";
import { setSessionCookie } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const POST = withErrorBoundary("POST /api/auth/dev", async () => {
  const env = getWebEnv();
  if (env.NODE_ENV === "production" || !env.DEV_WALLET) return jsonError(404, "not found");
  const { db } = getDb();
  const existing = await db.select().from(schema.users).where(eq(schema.users.walletAddress, env.DEV_WALLET)).limit(1);
  let user = existing[0];
  if (!user) {
    const inserted = await db.insert(schema.users).values({ walletAddress: env.DEV_WALLET }).returning();
    user = inserted[0];
  }
  if (!user) return jsonError(500, "could not create user");
  await setSessionCookie(user.id, user.walletAddress);
  return jsonOk({ userId: user.id, wallet: user.walletAddress, dev: true });
});
