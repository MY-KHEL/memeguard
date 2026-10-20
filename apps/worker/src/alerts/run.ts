import { and, desc, eq } from "drizzle-orm";
import { schema, type Database } from "@meme-guard/db";
import { DEFAULT_ALERT_PREFS, type AlertPrefs } from "@meme-guard/shared-types";
import type { JobStats } from "@meme-guard/shared-types";
import type { Logger } from "../logger";
import type { LiveBus } from "../live/bus";

function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function prefsOf(raw: unknown): AlertPrefs {
  if (!raw || typeof raw !== "object") return DEFAULT_ALERT_PREFS;
  const o = raw as { alerts?: Partial<AlertPrefs> };
  return { ...DEFAULT_ALERT_PREFS, ...o.alerts };
}

export async function insertNotification(
  db: Database,
  bus: LiveBus,
  row: { userId: string; type: string; dedupKey: string; payload: Record<string, unknown> },
): Promise<boolean> {
  const inserted = await db
    .insert(schema.notifications)
    .values({
      userId: row.userId,
      type: row.type,
      dedupKey: row.dedupKey,
      payload: row.payload,
    })
    .onConflictDoNothing()
    .returning({ id: schema.notifications.id });
  const id = inserted[0]?.id;
  if (!id) return false;
  await bus.publish({ type: "notification.new", userId: row.userId, notificationId: id, ts: new Date().toISOString() });
  return true;
}

export function createAlertWorker(deps: { db: Database; bus: LiveBus; log: Logger; intervalMs: number }) {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  const stats: JobStats = { lastRunAt: null, lastCycleMs: null, lastError: null };

  async function tick() {
    const started = performance.now();
    try {
      const users = await deps.db.select().from(schema.users);
      const open = await deps.db
        .select({
          position: schema.positions,
          priceUsd: schema.tokens.latestPrice,
          symbol: schema.tokens.symbol,
        })
        .from(schema.positions)
        .innerJoin(schema.tokens, eq(schema.tokens.mint, schema.positions.mint))
        .where(and(eq(schema.positions.status, "open"), eq(schema.positions.mode, "paper")));

      const latestPass = await deps.db
        .select()
        .from(schema.riskReports)
        .where(eq(schema.riskReports.verdict, "PASS"))
        .orderBy(desc(schema.riskReports.ts))
        .limit(30);

      const latestByMint = new Map<string, (typeof schema.riskReports.$inferSelect)>();
      const recent = await deps.db.select().from(schema.riskReports).orderBy(desc(schema.riskReports.ts)).limit(200);
      for (const r of recent) {
        if (!latestByMint.has(r.mint)) latestByMint.set(r.mint, r);
      }

      for (const user of users) {
        const prefs = prefsOf(user.settings);
        if (prefs.passCoins) {
          for (const report of latestPass) {
            if (report.score === null || report.score < prefs.passScoreMin) continue;
            const [token] = await deps.db.select({ symbol: schema.tokens.symbol }).from(schema.tokens).where(eq(schema.tokens.mint, report.mint)).limit(1);
            await insertNotification(deps.db, deps.bus, {
              userId: user.id,
              type: "pass_coin",
              dedupKey: `pass:${report.mint}`,
              payload: {
                title: `PASS ${token?.symbol ?? "token"}`,
                body: `Score ${report.score}. Paper only until you review the risk card.`,
                mint: report.mint,
                score: report.score,
                urgent: false,
              },
            });
          }
        }

        if (prefs.stops) {
          for (const row of open.filter((o) => o.position.userId === user.id)) {
            const plan = row.position.exitPlan as { stopPriceUsd?: number | null; ladder?: Array<{ multiple: number }> };
            const px = num(row.priceUsd);
            const entry = num(row.position.entryPrice) ?? 0;
            if (px !== null && plan.stopPriceUsd != null && px <= plan.stopPriceUsd) {
              await insertNotification(deps.db, deps.bus, {
                userId: user.id,
                type: "stop_hit",
                dedupKey: `stop:${row.position.id}`,
                payload: {
                  title: `Stop hit on ${row.symbol ?? "position"}`,
                  body: "Thin liquidity can slip. Review the exit plan before selling.",
                  positionId: row.position.id,
                  mint: row.position.mint,
                  urgent: true,
                },
              });
            }
            for (const step of plan.ladder ?? []) {
              if (px !== null && entry > 0 && px >= entry * step.multiple) {
                await insertNotification(deps.db, deps.bus, {
                  userId: user.id,
                  type: "ladder_hit",
                  dedupKey: `ladder:${row.position.id}:${step.multiple}`,
                  payload: {
                    title: `${step.multiple}x ladder on ${row.symbol ?? "position"}`,
                    body: "A scale-out level was reached. Stops on thin books can fail.",
                    positionId: row.position.id,
                    mint: row.position.mint,
                    multiple: step.multiple,
                    urgent: false,
                  },
                });
              }
            }
          }
        }

        if (prefs.verdictChange) {
          for (const row of open.filter((o) => o.position.userId === user.id)) {
            const report = latestByMint.get(row.position.mint);
            if (!report || report.verdict !== "BLOCKED") continue;
            await insertNotification(deps.db, deps.bus, {
              userId: user.id,
              type: "verdict_blocked",
              dedupKey: `verdict:${row.position.mint}:BLOCKED`,
              payload: {
                title: `${row.symbol ?? "Held coin"} is now BLOCKED`,
                body: "A coin you hold flipped to BLOCKED. This is urgent — review the risk card.",
                mint: row.position.mint,
                positionId: row.position.id,
                urgent: true,
              },
            });
          }
        }

        if (prefs.dailyLoss) {
          const events = await deps.db
            .select()
            .from(schema.limitEvents)
            .where(and(eq(schema.limitEvents.userId, user.id), eq(schema.limitEvents.type, "daily_loss")))
            .orderBy(desc(schema.limitEvents.ts))
            .limit(1);
          const ev = events[0];
          if (ev && ev.ts.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10)) {
            await insertNotification(deps.db, deps.bus, {
              userId: user.id,
              type: "daily_loss",
              dedupKey: `daily_loss:${user.id}:${ev.ts.toISOString().slice(0, 10)}`,
              payload: {
                title: "Daily loss lock",
                body: "New buys are blocked until the next UTC day.",
                urgent: true,
              },
            });
          }
        }
      }

      stats.lastError = null;
    } catch (error) {
      stats.lastError = error instanceof Error ? error.message : String(error);
      deps.log.warn({ err: stats.lastError }, "alert tick failed");
    } finally {
      stats.lastRunAt = new Date().toISOString();
      stats.lastCycleMs = Math.round(performance.now() - started);
    }
  }

  return {
    stats: () => stats,
    start() {
      stopped = false;
      deps.log.info({ intervalMs: deps.intervalMs }, "alert worker starting");
      const loop = async () => {
        if (stopped) return;
        await tick();
        if (!stopped) timer = setTimeout(() => void loop(), deps.intervalMs);
      };
      void loop();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
