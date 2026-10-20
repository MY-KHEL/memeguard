import { z } from "zod";
import { jsonError, jsonOk, withErrorBoundary } from "@/lib/api-response";
import { getRedis } from "@/lib/providers";
import { buildSiwsMessage, looksLikeWallet, newNonce } from "@/lib/auth/siws";

export const dynamic = "force-dynamic";

const query = z.object({ wallet: z.string().min(32).max(64) });

export const GET = withErrorBoundary("GET /api/auth/nonce", async (request: Request) => {
  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success || !looksLikeWallet(parsed.data.wallet)) return jsonError(400, "invalid wallet");
  const nonce = newNonce();
  const issuedAt = new Date().toISOString();
  await getRedis().set(`mg:nonce:${parsed.data.wallet}`, JSON.stringify({ nonce, issuedAt }), "EX", 300);
  return jsonOk({ wallet: parsed.data.wallet, nonce, issuedAt, message: buildSiwsMessage(parsed.data.wallet, nonce, issuedAt) });
});
