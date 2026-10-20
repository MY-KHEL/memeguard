import { meResponseSchema } from "@meme-guard/shared-types";
import { jsonError, jsonOk, withErrorBoundary } from "@/lib/api-response";
import { lockStatus, num, requireUser, toSessionUser } from "@/lib/auth/user";
import { equityFor, solUsdPrice } from "@/lib/trading/execute";

export const dynamic = "force-dynamic";

export const GET = withErrorBoundary("GET /api/me", async () => {
  const auth = await requireUser();
  if (!auth.ok) return jsonError(auth.status, auth.error);
  const solUsd = await solUsdPrice();
  const paper = num(auth.user.paperBalanceSol);
  const equity = await equityFor(auth.user.id, paper, solUsd);
  const locks = lockStatus(auth.settings, equity);
  return jsonOk(meResponseSchema.parse(await toSessionUser(auth.user, locks)));
});
