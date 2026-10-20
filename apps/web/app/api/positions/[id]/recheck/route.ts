import { and, eq } from "drizzle-orm";
import { schema } from "@meme-guard/db";
import { jsonError, jsonOk, withErrorBoundary } from "@/lib/api-response";
import { requireUser } from "@/lib/auth/user";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export const POST = withErrorBoundary("POST /api/positions/[id]/recheck", async (_request: Request, ctx: RouteContext<"/api/positions/[id]/recheck">) => {
  const auth = await requireUser();
  if (!auth.ok) return jsonError(auth.status, auth.error);
  const { id } = await ctx.params;
  const { db } = getDb();
  const [pos] = await db
    .select()
    .from(schema.positions)
    .where(and(eq(schema.positions.id, id), eq(schema.positions.userId, auth.user.id)))
    .limit(1);
  if (!pos) return jsonError(404, "position not found");
  const exitPlan = { ...(typeof pos.exitPlan === "object" && pos.exitPlan ? pos.exitPlan : {}), recheckAckedAt: new Date().toISOString() };
  await db.update(schema.positions).set({ exitPlan }).where(eq(schema.positions.id, id));
  return jsonOk({ ok: true });
});
