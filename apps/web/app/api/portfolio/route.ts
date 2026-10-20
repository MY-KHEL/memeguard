import { portfolioResponseSchema } from "@meme-guard/shared-types";
import { jsonError, jsonOk, withErrorBoundary } from "@/lib/api-response";
import { requireUser } from "@/lib/auth/user";
import { loadPortfolio, maybeNotifyLevels } from "@/lib/trading/portfolio";

export const dynamic = "force-dynamic";

export const GET = withErrorBoundary("GET /api/portfolio", async () => {
  const auth = await requireUser();
  if (!auth.ok) return jsonError(auth.status, auth.error);
  const portfolio = await loadPortfolio(auth.user, auth.settings);
  await maybeNotifyLevels(auth.user.id, portfolio);
  return jsonOk(portfolioResponseSchema.parse(portfolio));
});
