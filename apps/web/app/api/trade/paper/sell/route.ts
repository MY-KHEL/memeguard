import { paperSellSchema } from "@meme-guard/shared-types";
import { jsonError, jsonOk, withErrorBoundary } from "@/lib/api-response";
import { requireUser } from "@/lib/auth/user";
import { paperSell } from "@/lib/trading/execute";

export const dynamic = "force-dynamic";

export const POST = withErrorBoundary("POST /api/trade/paper/sell", async (request: Request) => {
  const auth = await requireUser();
  if (!auth.ok) return jsonError(auth.status, auth.error);
  const parsed = paperSellSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "invalid body");
  const result = await paperSell(auth.user, auth.settings, parsed.data);
  if (!result.ok) return jsonError(result.status, result.error);
  return jsonOk({ fill: result.fill, closed: result.closed, paperBalanceSol: result.paperBalanceSol });
});
