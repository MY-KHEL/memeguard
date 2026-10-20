import { z } from "zod";

/** Normalised candle used across providers and the web app. Time is unix seconds. */
export const candleSchema = z.object({
  time: z.number().int(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().nonnegative(),
});
export type Candle = z.infer<typeof candleSchema>;

export const CANDLE_TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export const candleTimeframeSchema = z.enum(CANDLE_TIMEFRAMES);
export type CandleTimeframe = z.infer<typeof candleTimeframeSchema>;

export const TIMEFRAME_SECONDS: Record<CandleTimeframe, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};

export function sortCandles(candles: Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const c of candles) byTime.set(c.time, c);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** Align unix seconds to the start of a timeframe bucket. */
export function candleBucket(nowSec: number, timeframeSeconds: number): number {
  return Math.floor(nowSec / timeframeSeconds) * timeframeSeconds;
}

/**
 * Patch OHLCV history with a live price. Updates the last bar in-place when
 * the tick is still in that bucket; opens a new bar when the bucket rolls.
 * Returns the same array reference when nothing changes.
 */
export function applyTickToCandles(candles: Candle[], priceUsd: number, nowSec: number, timeframeSeconds: number): Candle[] {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0 || !Number.isFinite(nowSec) || timeframeSeconds <= 0) return candles;

  const bucket = candleBucket(nowSec, timeframeSeconds);
  const last = candles[candles.length - 1];
  if (!last) {
    return [{ time: bucket, open: priceUsd, high: priceUsd, low: priceUsd, close: priceUsd, volume: 0 }];
  }
  if (nowSec < last.time) return candles;

  if (nowSec < last.time + timeframeSeconds) {
    const high = Math.max(last.high, priceUsd);
    const low = Math.min(last.low, priceUsd);
    if (last.close === priceUsd && last.high === high && last.low === low) return candles;
    return [...candles.slice(0, -1), { ...last, high, low, close: priceUsd }];
  }

  return [
    ...candles,
    {
      time: bucket,
      open: last.close,
      high: Math.max(last.close, priceUsd),
      low: Math.min(last.close, priceUsd),
      close: priceUsd,
      volume: 0,
    },
  ];
}

function liveBarOk(bar: Candle): boolean {
  return (
    Number.isInteger(bar.time) &&
    bar.time > 0 &&
    [bar.open, bar.high, bar.low, bar.close].every((n) => Number.isFinite(n) && n > 0) &&
    Number.isFinite(bar.volume) &&
    bar.volume >= 0 &&
    bar.high >= bar.low &&
    bar.high >= bar.close &&
    bar.low <= bar.close
  );
}

/**
 * Replace the bar at `bar.time`, or append it when it is newer than the series.
 * Older bars are ignored. Returns the same array when nothing changes.
 */
export function applyLiveCandle(candles: Candle[], bar: Candle): Candle[] {
  if (!liveBarOk(bar)) return candles;
  const last = candles[candles.length - 1];
  if (!last) return [bar];
  if (bar.time < last.time) return candles;
  if (bar.time === last.time) {
    if (last.open === bar.open && last.high === bar.high && last.low === bar.low && last.close === bar.close && last.volume === bar.volume) {
      return candles;
    }
    return [...candles.slice(0, -1), bar];
  }
  return [...candles, bar];
}

/** Market cap for the open coin: the candle close times circulating supply. */
export function marketCapFromClose(close: number, circulatingSupply: number | null | undefined): number | null {
  if (!Number.isFinite(close) || close <= 0) return null;
  if (circulatingSupply == null || !Number.isFinite(circulatingSupply) || circulatingSupply <= 0) return null;
  return close * circulatingSupply;
}
