import { looksLikeMint } from "@meme-guard/shared-types";
import { jsonError, providerJson, withErrorBoundary } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { getProviders } from "@/lib/providers";
import { getTokenRow } from "@/lib/tokens-query";

export const dynamic = "force-dynamic";

export const GET = withErrorBoundary("GET /api/tokens/[mint]/holders", async (_request: Request, ctx: RouteContext<"/api/tokens/[mint]/holders">) => {
  const { mint } = await ctx.params;
  if (!looksLikeMint(mint)) return jsonError(400, "invalid mint");

  const { db } = getDb();
  const row = await getTokenRow(db, mint);
  if (!row) return jsonError(404, "token not tracked");

  const providers = getProviders();
  // Percent-of-supply needs total supply; ask Helius once (cached 5 min). Missing supply means pct is null, not 0.
  const asset = await providers.helius.getAsset(mint);
  const supplyUi = asset.ok ? asset.data.supplyUi : null;
  const result = await providers.marketData.getHolders(mint, supplyUi, 20);
  return providerJson(result);
});
