import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@meme-guard/db";
import { jsonError, jsonOk, withErrorBoundary } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { getRedis } from "@/lib/providers";
import { setSessionCookie } from "@/lib/auth/session";
import { buildSiwsMessage, looksLikeWallet, verifySiws } from "@/lib/auth/siws";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  wallet: z.string().min(32).max(64),
  signature: z.string().min(1),
});

export const POST = withErrorBoundary("POST /api/auth/verify", async (request: Request) => {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !looksLikeWallet(parsed.data.wallet)) return jsonError(400, "invalid body");
  const raw = await getRedis().get(`mg:nonce:${parsed.data.wallet}`);
  if (!raw) return jsonError(401, "nonce expired");
  const { nonce, issuedAt } = JSON.parse(raw) as { nonce: string; issuedAt: string };
  const message = buildSiwsMessage(parsed.data.wallet, nonce, issuedAt);
  if (!verifySiws(parsed.data.wallet, message, parsed.data.signature)) return jsonError(401, "invalid signature");
  await getRedis().del(`mg:nonce:${parsed.data.wallet}`);

  const { db } = getDb();
  const existing = await db.select().from(schema.users).where(eq(schema.users.walletAddress, parsed.data.wallet)).limit(1);
  let user = existing[0];
  if (!user) {
    const inserted = await db.insert(schema.users).values({ walletAddress: parsed.data.wallet }).returning();
    user = inserted[0];
  }
  if (!user) return jsonError(500, "could not create user");
  await setSessionCookie(user.id, user.walletAddress);
  return jsonOk({ userId: user.id, wallet: user.walletAddress });
});
