import { eq } from "drizzle-orm";
import { schema } from "@meme-guard/db";
import { DEFAULT_ALERT_PREFS, meResponseSchema, settingsPatchSchema } from "@meme-guard/shared-types";
import { resolveLimits } from "@meme-guard/trading";
import { jsonError, jsonOk, withErrorBoundary } from "@/lib/api-response";
import { lockStatus, num, requireUser, toSessionUser } from "@/lib/auth/user";
import { getDb } from "@/lib/db";
import { equityFor, solUsdPrice } from "@/lib/trading/execute";

export const dynamic = "force-dynamic";

export const PATCH = withErrorBoundary("PATCH /api/me/settings", async (request: Request) => {
  const auth = await requireUser();
  if (!auth.ok) return jsonError(auth.status, auth.error);
  const parsed = settingsPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "invalid settings");
  const clamped = parsed.data.limits ? resolveLimits(parsed.data.limits) : resolveLimits(auth.settings.limits);
  const next = {
    ...auth.settings,
    limits: {
      maxPctPerCoin: clamped.maxPctPerCoin,
      maxOpenPositions: clamped.maxOpenPositions,
      maxPctLowMcap: clamped.maxPctLowMcap,
      dailyLossPct: clamped.dailyLossPct,
      cooldownAfterLossMinutes: clamped.cooldownAfterLossMinutes,
      highRiskMaxPct: clamped.highRiskMaxPct,
    },
    alerts: { ...DEFAULT_ALERT_PREFS, ...auth.settings.alerts, ...parsed.data.alerts },
  };
  const { db } = getDb();
  const [user] = await db.update(schema.users).set({ settings: next }).where(eq(schema.users.id, auth.user.id)).returning();
  if (!user) return jsonError(500, "could not save");
  const solUsd = await solUsdPrice();
  const paper = num(user.paperBalanceSol);
  const equity = await equityFor(user.id, paper, solUsd);
  return jsonOk(meResponseSchema.parse(await toSessionUser(user, lockStatus(next, equity))));
});
