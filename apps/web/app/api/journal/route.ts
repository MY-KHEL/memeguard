import { desc, eq } from "drizzle-orm";
import { schema } from "@meme-guard/db";
import { journalResponseSchema } from "@meme-guard/shared-types";
import { jsonError, jsonOk, withErrorBoundary } from "@/lib/api-response";
import { requireUser } from "@/lib/auth/user";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = withErrorBoundary("GET /api/journal", async () => {
  const auth = await requireUser();
  if (!auth.ok) return jsonError(auth.status, auth.error);
  const rows = await getDb()
    .db.select({
      id: schema.journalEntries.id,
      positionId: schema.journalEntries.positionId,
      thesis: schema.journalEntries.thesis,
      outcomeNotes: schema.journalEntries.outcomeNotes,
      mistakeTag: schema.journalEntries.mistakeTag,
      createdAt: schema.journalEntries.createdAt,
      mint: schema.positions.mint,
      symbol: schema.tokens.symbol,
    })
    .from(schema.journalEntries)
    .leftJoin(schema.positions, eq(schema.positions.id, schema.journalEntries.positionId))
    .leftJoin(schema.tokens, eq(schema.tokens.mint, schema.positions.mint))
    .where(eq(schema.journalEntries.userId, auth.user.id))
    .orderBy(desc(schema.journalEntries.createdAt));

  return jsonOk(
    journalResponseSchema.parse({
      items: rows.map((r) => ({
        id: r.id,
        positionId: r.positionId,
        mint: r.mint,
        symbol: r.symbol,
        thesis: r.thesis,
        outcomeNotes: r.outcomeNotes,
        mistakeTag: r.mistakeTag,
        createdAt: r.createdAt.toISOString(),
      })),
    }),
  );
});
