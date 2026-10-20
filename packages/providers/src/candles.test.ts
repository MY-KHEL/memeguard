import { describe, expect, it } from "vitest";
import { applyLiveCandle, applyTickToCandles, candleBucket, marketCapFromClose, type Candle } from "./candles";

const bar = (over: Partial<Candle> = {}): Candle => ({
  time: 1_700_000_000,
  open: 1,
  high: 1.2,
  low: 0.9,
  close: 1.1,
  volume: 10,
  ...over,
});

describe("applyTickToCandles", () => {
  it("opens the first bar on an empty series", () => {
    const now = 1_700_000_030;
    const next = applyTickToCandles([], 2, now, 60);
    expect(next).toEqual([{ time: candleBucket(now, 60), open: 2, high: 2, low: 2, close: 2, volume: 0 }]);
  });

  it("updates high, low and close inside the current bucket and keeps open", () => {
    const last = bar({ time: 1_700_000_040, open: 1, high: 1.1, low: 0.95, close: 1.05 });
    const up = applyTickToCandles([last], 1.4, last.time + 10, 60);
    expect(up[0]).toMatchObject({ time: last.time, open: 1, high: 1.4, low: 0.95, close: 1.4, volume: 10 });

    const down = applyTickToCandles([last], 0.8, last.time + 10, 60);
    expect(down[0]).toMatchObject({ time: last.time, open: 1, high: 1.1, low: 0.8, close: 0.8 });
  });

  it("returns the same array when the last bar already matches the tick", () => {
    const last = bar({ close: 1.1, high: 1.2, low: 0.9 });
    const series = [last];
    expect(applyTickToCandles(series, 1.1, last.time + 5, 60)).toBe(series);
  });

  it("opens a new bar when the timeframe bucket rolls", () => {
    const last = bar({ time: 1_700_000_000, close: 1.1, high: 1.2, low: 0.9 });
    const now = last.time + 60;
    const next = applyTickToCandles([last], 1.3, now, 60);
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({
      time: candleBucket(now, 60),
      open: 1.1,
      high: 1.3,
      low: 1.1,
      close: 1.3,
      volume: 0,
    });
  });

  it("leaves candles unchanged for invalid prices or a tick before the last bar", () => {
    const series = [bar()];
    expect(applyTickToCandles(series, 0, series[0]!.time + 1, 60)).toBe(series);
    expect(applyTickToCandles(series, Number.NaN, series[0]!.time + 1, 60)).toBe(series);
    expect(applyTickToCandles(series, 1.5, series[0]!.time - 1, 60)).toBe(series);
  });
});

describe("applyLiveCandle", () => {
  it("replaces the bar in the same bucket", () => {
    const last = bar({ time: 1_700_000_040 });
    const next = applyLiveCandle([last], { time: last.time, open: 1, high: 1.5, low: 0.8, close: 1.4, volume: 12 });
    expect(next).toEqual([{ time: last.time, open: 1, high: 1.5, low: 0.8, close: 1.4, volume: 12 }]);
  });

  it("appends a newer bucket", () => {
    const last = bar({ time: 1_700_000_000, close: 1.1 });
    const next = applyLiveCandle([last], { time: last.time + 60, open: 1.1, high: 1.3, low: 1.05, close: 1.2, volume: 4 });
    expect(next).toHaveLength(2);
    expect(next[1]?.close).toBe(1.2);
  });

  it("ignores an older bar and an identical bar", () => {
    const series = [bar()];
    expect(applyLiveCandle(series, { ...series[0]!, time: series[0]!.time - 60 })).toBe(series);
    expect(applyLiveCandle(series, series[0]!)).toBe(series);
  });

  it("rejects a bar whose close is outside high and low", () => {
    const series = [bar()];
    expect(applyLiveCandle(series, { ...series[0]!, close: 9 })).toBe(series);
  });
});

describe("marketCapFromClose", () => {
  it("multiplies the close by circulating supply", () => {
    expect(marketCapFromClose(0.00002, 1_000_000_000)).toBe(20_000);
  });

  it("returns null when the close or the supply is missing", () => {
    expect(marketCapFromClose(1, null)).toBeNull();
    expect(marketCapFromClose(1, undefined)).toBeNull();
    expect(marketCapFromClose(1, 0)).toBeNull();
    expect(marketCapFromClose(Number.NaN, 10)).toBeNull();
    expect(marketCapFromClose(0, 10)).toBeNull();
  });
});
