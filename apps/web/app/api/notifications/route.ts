import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { schema } from "@meme-guard/db";
import { notificationDtoSchema, notificationsResponseSchema } from "@meme-guard/shared-types";
import { jsonError, jsonOk, withErrorBoundary } from "@/lib/api-response";
import { requireUser } from "@/lib/auth/user";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

function toDto(row: typeof schema.notifications.$inferSelect) {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  return notificationDtoSchema.parse({
    id: row.id,
    type: row.type,
    title: typeof payload.title === "string" ? payload.title : row.type,
    body: typeof payload.body === "string" ? payload.body : "",
    payload,
    urgent: payload.urgent === true,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  });
}

export const GET = withErrorBoundary("GET /api/notifications", async () => {
  const auth = await requireUser();
  if (!auth.ok) return jsonError(auth.status, auth.error);
  const { db } = getDb();
  const items = await db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, auth.user.id))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(50);
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, auth.user.id), isNull(schema.notifications.readAt)));
  return jsonOk(notificationsResponseSchema.parse({ items: items.map(toDto), unread: count?.n ?? items.filter((i) => !i.readAt).length }));
});

export const POST = withErrorBoundary("POST /api/notifications", async () => {
  const auth = await requireUser();
  if (!auth.ok) return jsonError(auth.status, auth.error);
  const { db } = getDb();
  await db.update(schema.notifications).set({ readAt: new Date() }).where(eq(schema.notifications.userId, auth.user.id));
  return jsonOk({ ok: true });
});
