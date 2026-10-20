import { tokenListQuerySchema } from "@meme-guard/shared-types";
import { jsonError, jsonOk, withErrorBoundary } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { listTokens } from "@/lib/tokens-query";

export const dynamic = "force-dynamic";

export const GET = withErrorBoundary("GET /api/tokens", async (request: Request) => {
  const url = new URL(request.url);
  const raw = Object.fromEntries(url.searchParams.entries());
  const parsed = tokenListQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, "invalid query", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const { db } = getDb();
  const page = await Promise.race([
    listTokens(db, parsed.data),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("token list timed out after 8000ms")), 8_000);
    }),
  ]);
  return jsonOk(page);
});
