import type { CandleTimeframe, LiveEvent } from "@meme-guard/shared-types";
import { getRedis } from "@/lib/providers";
import { logger } from "@/lib/logger";

export const LIVE_CHANNEL = "mg:live";
export const WATCH_KEY = "mg:watch";
export const CHART_KEY = "mg:chart";

export async function publishLive(event: LiveEvent): Promise<void> {
  try {
    await getRedis().publish(LIVE_CHANNEL, JSON.stringify(event));
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, "live publish failed");
  }
}

export async function registerWatched(mints: string[], ttlSec = 30): Promise<void> {
  if (mints.length === 0) return;
  const redis = getRedis();
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const args: Array<string | number> = [];
  for (const mint of mints) args.push(exp, mint);
  await redis.zadd(WATCH_KEY, ...args);
}

/** The coin page whose chart is open. Member is `mint|timeframe`, score is expiry. */
export async function registerChart(mint: string, timeframe: CandleTimeframe, ttlSec = 30): Promise<void> {
  const redis = getRedis();
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const member = `${mint}|${timeframe}`;
  const existing = await redis.zrange(CHART_KEY, 0, -1);
  const stale = existing.filter((item) => item.startsWith(`${mint}|`) && item !== member);
  if (stale.length > 0) await redis.zrem(CHART_KEY, ...stale);
  await redis.zadd(CHART_KEY, exp, member);
}
