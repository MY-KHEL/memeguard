import { looksLikeMint } from "@meme-guard/shared-types";
import { jsonError, jsonOk, withErrorBoundary } from "@/lib/api-response";
import { loadTokenDetail } from "@/lib/token-detail";

export const dynamic = "force-dynamic";

export const GET = withErrorBoundary("GET /api/tokens/[mint]", async (_request: Request, ctx: RouteContext<"/api/tokens/[mint]">) => {
  const { mint } = await ctx.params;
  if (!looksLikeMint(mint)) return jsonError(400, "invalid mint");
  const detail = await loadTokenDetail(mint);
  if (!detail) return jsonError(404, "token not tracked");
  return jsonOk(detail);
});
