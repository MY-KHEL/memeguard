import { eq } from "drizzle-orm";
import { schema } from "@meme-guard/db";
import { isRugged, riskConfig } from "@meme-guard/core";
import { calibrationReportSchema } from "@meme-guard/shared-types";
import { jsonError, jsonOk, withErrorBoundary } from "@/lib/api-response";
import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getWebEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export const GET = withErrorBoundary("GET /api/calibration", async () => {
  const env = getWebEnv();
  const session = await getSession();
  if (!session) return jsonError(401, "sign in required");
  if (env.NODE_ENV === "production" && env.CALIBRATION_ADMIN_WALLET && session.wallet !== env.CALIBRATION_ADMIN_WALLET) {
    return jsonError(403, "admin only");
  }

  const { db } = getDb();
  const rows = await db
    .select({
      outcome: schema.alertOutcomes,
      report: schema.riskReports,
    })
    .from(schema.alertOutcomes)
    .innerJoin(schema.riskReports, eq(schema.riskReports.id, schema.alertOutcomes.riskReportId))
    .where(eq(schema.alertOutcomes.offsetMinutes, 1440));

  const drop = riskConfig.calibration.rugged_drop_pct;
  const byRule = new Map<string, { blocked: number; rugged: number }>();
  const byBand = new Map<string, { pass: number; sumPct: number; n: number }>();
  const byVersion = new Map<string, { reports: number; rugged: number }>();

  for (const { outcome, report } of rows) {
    const rugged = isRugged(num(outcome.basePrice) ?? num(outcome.baseMarketCap), num(outcome.price) ?? num(outcome.marketCap), drop);
    const version = byVersion.get(report.configVersion) ?? { reports: 0, rugged: 0 };
    version.reports += 1;
    if (rugged) version.rugged += 1;
    byVersion.set(report.configVersion, version);

    if (report.verdict === "BLOCKED") {
      const fails = (report.hardFailReasons as Array<{ rule?: string }>) ?? [];
      for (const reason of fails) {
        const rule = reason.rule ?? "unknown";
        const bucket = byRule.get(rule) ?? { blocked: 0, rugged: 0 };
        bucket.blocked += 1;
        if (rugged) bucket.rugged += 1;
        byRule.set(rule, bucket);
      }
    }

    if (report.verdict === "PASS") {
      const band = ((report.scoreBreakdown as { band?: string }).band ?? "UNKNOWN");
      const bucket = byBand.get(band) ?? { pass: 0, sumPct: 0, n: 0 };
      bucket.pass += 1;
      const base = num(outcome.basePrice);
      const later = num(outcome.price);
      if (base !== null && later !== null && base > 0) {
        bucket.sumPct += ((later - base) / base) * 100;
        bucket.n += 1;
      }
      byBand.set(band, bucket);
    }
  }

  const times = rows.map((r) => r.outcome.baseTs.getTime());
  const oldest = times.length ? new Date(Math.min(...times)).toISOString() : null;
  const newest = times.length ? new Date(Math.max(...times)).toISOString() : null;
  const spanDays = oldest && newest ? (Date.parse(newest) - Date.parse(oldest)) / 86_400_000 : 0;

  return jsonOk(
    calibrationReportSchema.parse({
      generatedAt: new Date().toISOString(),
      outcomeCount: rows.length,
      oldestBaseTs: oldest,
      newestBaseTs: newest,
      enoughHistory: spanDays >= 7 && rows.length > 0,
      byRule: [...byRule.entries()].map(([rule, v]) => ({
        rule,
        blocked: v.blocked,
        rugged: v.rugged,
        ruggedRate: v.blocked > 0 ? v.rugged / v.blocked : null,
      })),
      byBand: [...byBand.entries()].map(([band, v]) => ({
        band,
        pass: v.pass,
        avgReturnPct: v.n > 0 ? v.sumPct / v.n : null,
      })),
      byConfigVersion: [...byVersion.entries()].map(([configVersion, v]) => ({
        configVersion,
        reports: v.reports,
        rugged: v.rugged,
      })),
    }),
  );
});
