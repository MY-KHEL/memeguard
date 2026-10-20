import { eq } from "drizzle-orm";
import { schema } from "@meme-guard/db";
import { paperBuySchema } from "@meme-guard/shared-types";
import { jsonError, jsonOk, withErrorBoundary } from "@/lib/api-response";
import { requireUser } from "@/lib/auth/user";
import { getDb } from "@/lib/db";
import { paperBuy } from "@/lib/trading/execute";

export const dynamic = "force-dynamic";

export const POST = withErrorBoundary("POST /api/trade/paper/buy", async (request: Request) => {
  const auth = await requireUser();
  if (!auth.ok) return jsonError(auth.status, auth.error);
  const parsed = paperBuySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "invalid body", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  const result = await paperBuy(auth.user, auth.settings, parsed.data);
  if (!result.ok) {
    if (result.error === "limit") {
      await getDb().db.insert(schema.limitEvents).values({
        userId: auth.user.id,
        type: result.violations?.some((v) => v.rule === "daily_loss_lock" && v.result === "fail")
          ? "daily_loss"
          : result.violations?.some((v) => v.rule === "cooldown_after_loss" && v.result === "fail")
            ? "cooldown"
            : "size_cap",
        detail: { violations: result.violations },
      });
    }
    return jsonError(result.status, result.error, "violations" in result ? result.violations : undefined);
  }
  const [user] = await getDb().db.select().from(schema.users).where(eq(schema.users.id, auth.user.id)).limit(1);
  return jsonOk({
    positionId: result.positionId,
    fill: result.fill,
    paperBalanceSol: result.paperBalanceSol,
    wallet: user?.walletAddress,
  });
});
