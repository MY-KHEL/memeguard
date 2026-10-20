import { and, eq } from "drizzle-orm";
import { schema } from "@meme-guard/db";
import { jsonError, jsonOk, withErrorBoundary } from "@/lib/api-response";
import { requireUser } from "@/lib/auth/user";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export const POST = withErrorBoundary("POST /api/notifications/[id]/read", async (_request: Request, ctx: RouteContext<"/api/notifications/[id]/read">) => {
  const auth = await requireUser();
  if (!auth.ok) return jsonError(auth.status, auth.error);
  const { id } = await ctx.params;
  const { db } = getDb();
  await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(schema.notifications.id, id), eq(schema.notifications.userId, auth.user.id)));
  return jsonOk({ ok: true });
});
