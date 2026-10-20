import { and, eq } from "drizzle-orm";
import { schema } from "@meme-guard/db";
import { journalPatchSchema } from "@meme-guard/shared-types";
import { jsonError, jsonOk, withErrorBoundary } from "@/lib/api-response";
import { requireUser } from "@/lib/auth/user";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export const PATCH = withErrorBoundary("PATCH /api/journal/[id]", async (request: Request, ctx: RouteContext<"/api/journal/[id]">) => {
  const auth = await requireUser();
  if (!auth.ok) return jsonError(auth.status, auth.error);
  const { id } = await ctx.params;
  const parsed = journalPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "invalid body");
  const [row] = await getDb()
    .db.update(schema.journalEntries)
    .set({ mistakeTag: parsed.data.mistakeTag })
    .where(and(eq(schema.journalEntries.id, id), eq(schema.journalEntries.userId, auth.user.id)))
    .returning({ id: schema.journalEntries.id, mistakeTag: schema.journalEntries.mistakeTag });
  if (!row) return jsonError(404, "journal entry not found");
  return jsonOk(row);
});
