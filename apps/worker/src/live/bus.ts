import type Redis from "ioredis";
import { candleTimeframeSchema, looksLikeMint, type CandleTimeframe, type LiveEvent } from "@meme-guard/shared-types";
import type { Logger } from "../logger";

export const LIVE_CHANNEL = "mg:live";
export const WATCH_KEY = "mg:watch";
export const CHART_KEY = "mg:chart";

export type ChartWatch = { mint: string; timeframe: CandleTimeframe };

export function parseChartMember(member: string): ChartWatch | null {
  const split = member.lastIndexOf("|");
  if (split <= 0) return null;
  const mint = member.slice(0, split);
  const timeframe = candleTimeframeSchema.safeParse(member.slice(split + 1));
  if (!timeframe.success || !looksLikeMint(mint)) return null;
  return { mint, timeframe: timeframe.data };
}

export function createLiveBus(redis: Redis, log: Logger) {
  return {
    async publish(event: LiveEvent) {
      try {
        await redis.publish(LIVE_CHANNEL, JSON.stringify(event));
      } catch (error) {
        log.warn({ err: String(error), type: event.type }, "live publish failed");
      }
    },
    async watchedMints(max: number): Promise<string[]> {
      const now = Math.floor(Date.now() / 1000);
      await redis.zremrangebyscore(WATCH_KEY, 0, now);
      return redis.zrange(WATCH_KEY, 0, max - 1, "REV");
    },
    async watchedCharts(max: number): Promise<ChartWatch[]> {
      const now = Math.floor(Date.now() / 1000);
      await redis.zremrangebyscore(CHART_KEY, 0, now);
      const members = await redis.zrange(CHART_KEY, 0, max - 1, "REV");
      const charts: ChartWatch[] = [];
      for (const member of members) {
        const parsed = parseChartMember(member);
        if (parsed) charts.push(parsed);
      }
      return charts;
    },
  };
}

export type LiveBus = ReturnType<typeof createLiveBus>;
