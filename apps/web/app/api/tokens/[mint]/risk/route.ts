import { desc, eq } from "drizzle-orm";
import { schema } from "@meme-guard/db";
import { looksLikeMint, riskReportSchema } from "@meme-guard/shared-types";
import { jsonError, jsonOk, withErrorBoundary } from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { getRedis } from "@/lib/providers";

export const dynamic = "force-dynamic";

const WANTED_KEY = "risk:wanted";

export const GET = withErrorBoundary("GET /api/tokens/[mint]/risk", async (_request: Request, ctx: RouteContext<"/api/tokens/[mint]/risk">) => {
  const { mint } = await ctx.params;
  if (!looksLikeMint(mint)) return jsonError(400, "invalid mint");

  const [row] = await getDb()
    .db.select()
    .from(schema.riskReports)
    .where(eq(schema.riskReports.mint, mint))
    .orderBy(desc(schema.riskReports.ts))
    .limit(1);

  if (!row) {
    try {
      await getRedis().sadd(WANTED_KEY, mint);
    } catch {
      // Worker will still pick it up on the next due cycle.
    }
    return jsonOk(
      riskReportSchema.parse({
        mint,
        verdict: "UNVERIFIED",
        score: null,
        band: null,
        reasons: [
          {
            rule: "not_evaluated",
            value: null,
            threshold: null,
            result: "unverified",
            source: "worker",
            detail: "queued for the next risk cycle; this route never calls providers",
          },
        ],
        factors: [],
        unavailableSources: ["worker"],
        dataFreshness: new Date().toISOString(),
        configVersion: "pending",
        evaluatedAt: new Date(0).toISOString(),
        pending: true,
      }),
    );
  }

  const breakdown = (row.scoreBreakdown ?? {}) as {
    factors?: unknown;
    reasons?: unknown;
    unavailableSources?: unknown;
    dataFreshness?: string;
    band?: "LOWER_RISK" | "MEDIUM" | "HIGH" | null;
  };

  return jsonOk(
    riskReportSchema.parse({
      mint,
      verdict: row.verdict,
      score: row.score,
      band: breakdown.band ?? null,
      reasons: Array.isArray(breakdown.reasons) ? breakdown.reasons : row.hardFailReasons,
      factors: Array.isArray(breakdown.factors) ? breakdown.factors : [],
      unavailableSources: Array.isArray(breakdown.unavailableSources) ? breakdown.unavailableSources : [],
      dataFreshness: breakdown.dataFreshness ?? row.ts.toISOString(),
      configVersion: row.configVersion,
      evaluatedAt: row.ts.toISOString(),
    }),
  );
});
