import { eq } from "drizzle-orm";
import { schema } from "@meme-guard/db";
import { applyRegimeToLimits, resolveLimits, tradingConfig, type LimitOverrides } from "@meme-guard/trading";
import { DEFAULT_ALERT_PREFS, alertPrefsSchema, limitOverridesSchema, type AlertPrefs, type Regime, type SessionUser } from "@meme-guard/shared-types";
import { latestRegime } from "@/lib/regime";
import { getDb } from "@/lib/db";
import { getWebEnv } from "@/lib/env";
import { getSession } from "./session";
import { dailyLossPct } from "@meme-guard/trading";

export interface UserSettings {
  limits?: LimitOverrides;
  alerts?: AlertPrefs;
  lastLosingTradeAt?: string | null;
  dailyLoss?: { date: string; startEquitySol: number };
}

export function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function parseSettings(raw: unknown): UserSettings {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const limits = limitOverridesSchema.safeParse(o.limits);
  const alerts = alertPrefsSchema.partial().safeParse(o.alerts);
  return {
    limits: limits.success ? limits.data : undefined,
    alerts: alerts.success ? { ...DEFAULT_ALERT_PREFS, ...alerts.data } : DEFAULT_ALERT_PREFS,
    lastLosingTradeAt: typeof o.lastLosingTradeAt === "string" ? o.lastLosingTradeAt : null,
    dailyLoss:
      o.dailyLoss && typeof o.dailyLoss === "object"
        ? {
            date: String((o.dailyLoss as { date?: unknown }).date ?? ""),
            startEquitySol: num((o.dailyLoss as { startEquitySol?: string | number | null }).startEquitySol),
          }
        : undefined,
  };
}

export function utcDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function requireUser(): Promise<
  | { ok: true; user: typeof schema.users.$inferSelect; settings: UserSettings }
  | { ok: false; status: 401; error: string }
> {
  const session = await getSession();
  if (!session) return { ok: false, status: 401, error: "sign in required" };
  const { db } = getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId)).limit(1);
  if (!user || user.walletAddress !== session.wallet) return { ok: false, status: 401, error: "session expired" };
  return { ok: true, user, settings: parseSettings(user.settings) };
}

export async function toSessionUser(
  user: typeof schema.users.$inferSelect,
  extras: { dailyLossLocked: boolean; cooldownUntil: string | null; regime?: Regime | null },
): Promise<SessionUser> {
  const env = getWebEnv();
  const settings = parseSettings(user.settings);
  const regime = extras.regime !== undefined ? extras.regime : await latestRegime();
  const limitSettings = resolveLimits(settings.limits);
  const limits = applyRegimeToLimits(limitSettings, regime);
  return {
    userId: user.id,
    wallet: user.walletAddress,
    paperBalanceSol: num(user.paperBalanceSol),
    limits,
    limitSettings,
    dailyLossLocked: extras.dailyLossLocked,
    cooldownUntil: extras.cooldownUntil,
    devAuthAvailable: env.NODE_ENV !== "production" && Boolean(env.DEV_WALLET),
    regime,
    alerts: settings.alerts ?? DEFAULT_ALERT_PREFS,
    pushEmailConfigured: { webPush: false, email: false },
  };
}

export function lockStatus(settings: UserSettings, equitySol: number, now = new Date()) {
  const limits = resolveLimits(settings.limits);
  const today = utcDate(now);
  const start = settings.dailyLoss?.date === today ? settings.dailyLoss.startEquitySol : equitySol;
  const loss = dailyLossPct(start, equitySol);
  const dailyLossLocked = loss >= limits.dailyLossPct;
  let cooldownUntil: string | null = null;
  if (settings.lastLosingTradeAt) {
    const until = new Date(new Date(settings.lastLosingTradeAt).getTime() + limits.cooldownAfterLossMinutes * 60_000);
    if (now.getTime() < until.getTime()) cooldownUntil = until.toISOString();
  }
  return { dailyLossLocked, cooldownUntil, dayStartEquitySol: start };
}

export { tradingConfig };
