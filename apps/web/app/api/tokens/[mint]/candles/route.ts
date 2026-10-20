import { candleTimeframeSchema, looksLikeMint } from "@meme-guard/shared-types";
import { jsonError, providerJson, withErrorBoundary } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { getProviders } from "@/lib/providers";
import { getTokenRow } from "@/lib/tokens-query";

export const dynamic = "force-dynamic";

export const GET = withErrorBoundary("GET /api/tokens/[mint]/candles", async (request: Request, ctx: RouteContext<"/api/tokens/[mint]/candles">) => {
  const { mint } = await ctx.params;
  if (!looksLikeMint(mint)) return jsonError(400, "invalid mint");

  const tf = candleTimeframeSchema.safeParse(new URL(request.url).searchParams.get("tf") ?? "5m");
  if (!tf.success) return jsonError(400, "invalid timeframe");

  const { db } = getDb();
  const row = await getTokenRow(db, mint);
  if (!row) return jsonError(404, "token not tracked");

  const result = await getProviders().marketData.getCandles({ mint, pairAddress: row.pairAddress }, tf.data, 300);
  return providerJson(result);
});
// 